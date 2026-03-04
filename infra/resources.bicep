targetScope = 'resourceGroup'

@description('Name of the environment')
param environmentName string

@description('Location for all resources')
param location string = resourceGroup().location

@description('Tags for all resources')
param tags object = {}

@secure()
@description('GitHub token for Copilot SDK')
param githubToken string = ''

@description('Email address to receive Azure Monitor alert notifications. Leave empty to disable.')
param alertEmail string = ''

@description('Unique suffix for resource names')
param resourceSuffix string

@description('Short environment name for constrained resources')
param shortName string

@description('Deploy Azure OpenAI for BYOM. Set to true to provision AI resources.')
param useAzureModel bool = false

@description('Azure OpenAI model deployment name (must support Copilot SDK encrypted content)')
@allowed([
  'o4-mini'
  'o3'
  'o3-mini'
  'gpt-5'
  'gpt-5-mini'
  'gpt-5.1'
  'gpt-5.1-mini'
  'gpt-5.1-nano'
  'gpt-5.2-codex'
  'codex-mini'
])
param azureModelName string = 'o4-mini'

@description('Azure OpenAI model version (must match the model name; see `az cognitiveservices model list`)')
param azureModelVersion string = '2025-04-16'

// ===================== //
// AZD Pattern: Monitoring (Log Analytics + App Insights)
// ===================== //

module monitoring 'br/public:avm/ptn/azd/monitoring:0.2.1' = {
  name: 'monitoring'
  params: {
    logAnalyticsName: 'law-${environmentName}-${resourceSuffix}'
    applicationInsightsName: 'ai-${environmentName}-${resourceSuffix}'
    location: location
    tags: tags
  }
}

// ===================== //
// AVM Resource: Managed Identity
// ===================== //

module managedIdentity 'br/public:avm/res/managed-identity/user-assigned-identity:0.5.0' = {
  name: 'managed-identity'
  params: {
    name: 'id-${environmentName}-${resourceSuffix}'
    location: location
    tags: tags
  }
}

// ===================== //
// AVM Resource: Key Vault (stores COPILOT_GITHUB_TOKEN)
// ===================== //

module keyVault 'br/public:avm/res/key-vault/vault:0.13.3' = {
  name: 'key-vault'
  params: {
    name: 'kv-${shortName}-${resourceSuffix}'
    location: location
    tags: tags
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: false
    softDeleteRetentionInDays: 7
    sku: 'standard'
    secrets: [
      {
        name: 'github-token'
        value: githubToken
      }
    ]
    roleAssignments: [
      {
        principalId: managedIdentity.outputs.principalId
        roleDefinitionIdOrName: 'Key Vault Secrets User'
        principalType: 'ServicePrincipal'
      }
    ]
  }
}

// ===================== //
// AZD Pattern: Container Apps Stack (Environment + ACR)
// ===================== //

module containerAppsStack 'br/public:avm/ptn/azd/container-apps-stack:0.3.0' = {
  name: 'container-apps-stack'
  params: {
    containerAppsEnvironmentName: 'cae-${environmentName}-${resourceSuffix}'
    containerRegistryName: 'acr${shortName}${resourceSuffix}'
    logAnalyticsWorkspaceName: monitoring.outputs.logAnalyticsWorkspaceName
    appInsightsConnectionString: monitoring.outputs.applicationInsightsConnectionString
    location: location
    tags: tags
    acrSku: 'Basic'
    acrAdminUserEnabled: false
    zoneRedundant: false
    publicNetworkAccess: 'Enabled'
  }
}

// ===================== //
// Azure OpenAI (conditional, for BYOM)
// ===================== //

resource openai 'Microsoft.CognitiveServices/accounts@2024-10-01' = if (useAzureModel) {
  name: 'oai-${environmentName}-${resourceSuffix}'
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: 'oai-${environmentName}-${resourceSuffix}'
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
  }
}

resource openaiDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = if (useAzureModel) {
  parent: openai
  name: azureModelName
  sku: {
    name: 'GlobalStandard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: azureModelName
      version: azureModelVersion
    }
  }
}

resource openaiRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (useAzureModel) {
  scope: openai
  name: guid(resourceGroup().id, 'openai-role', 'id-${environmentName}-${resourceSuffix}', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
    principalId: managedIdentity.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// ===================== //
// Azure Cosmos DB (Serverless, NoSQL — conversation store)
// ===================== //

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: 'cosmos-${environmentName}-${resourceSuffix}'
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmosAccount
  name: 'conversations'
  properties: {
    resource: {
      id: 'conversations'
    }
  }
}

resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDatabase
  name: 'messages'
  properties: {
    resource: {
      id: 'messages'
      partitionKey: {
        paths: ['/conversationId']
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [
          { path: '/*' }
        ]
        excludedPaths: [
          { path: '/"_etag"/?' }
        ]
      }
      defaultTtl: 86400 // 24 hours — auto-expire old conversations
    }
  }
}

// Cosmos DB Built-in Data Contributor role for the managed identity
resource cosmosRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = {
  parent: cosmosAccount
  name: guid(resourceGroup().id, 'cosmos-data-contributor', 'id-${environmentName}-${resourceSuffix}')
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    principalId: managedIdentity.outputs.principalId
    scope: cosmosAccount.id
  }
}

// ===================== //
// AZD Pattern: ACR Container App - API (internal, accessed through web)
// ===================== //

module containerAppApi 'br/public:avm/ptn/azd/acr-container-app:0.4.0' = {
  name: 'container-app-api'
  params: {
    name: 'ca-api-${environmentName}-${resourceSuffix}'
    location: location
    tags: union(tags, { 'azd-service-name': 'api' })
    containerAppsEnvironmentName: containerAppsStack.outputs.environmentName
    containerRegistryName: containerAppsStack.outputs.registryName
    identityType: 'UserAssigned'
    identityName: managedIdentity.outputs.name
    userAssignedIdentityResourceId: managedIdentity.outputs.resourceId
    principalId: managedIdentity.outputs.principalId
    targetPort: 3000
    external: false
    ingressTransport: 'http'
    containerCpuCoreCount: '0.5'
    containerMemory: '1.0Gi'
    containerMinReplicas: 1
    containerMaxReplicas: 3
    env: union(
      [
        { name: 'PORT', value: '3000' }
        { name: 'ALLOWED_ORIGINS', value: 'https://ca-web-${environmentName}-${resourceSuffix}.${containerAppsStack.outputs.defaultDomain}' }
        { name: 'COPILOT_GITHUB_TOKEN', secretRef: 'github-token' }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: monitoring.outputs.applicationInsightsConnectionString
        }
        { name: 'COSMOS_ENDPOINT', value: cosmosAccount.properties.documentEndpoint }
        { name: 'COSMOS_DATABASE', value: 'conversations' }
        { name: 'AZURE_CLIENT_ID', value: managedIdentity.outputs.clientId }
      ],
      useAzureModel ? [
        { name: 'MODEL_PROVIDER', value: 'azure' }
        { name: 'MODEL_NAME', value: azureModelName }
        { name: 'AZURE_OPENAI_ENDPOINT', value: openai!.properties.endpoint }
      ] : []
    )
    secrets: [
      {
        name: 'github-token'
        keyVaultUrl: keyVault.outputs.secrets[0].uri
        identity: managedIdentity.outputs.resourceId
      }
    ]
  }
}

// ===================== //
// AZD Pattern: ACR Container App - Web
// ===================== //

module containerAppWeb 'br/public:avm/ptn/azd/acr-container-app:0.4.0' = {
  name: 'container-app-web'
  params: {
    name: 'ca-web-${environmentName}-${resourceSuffix}'
    location: location
    tags: union(tags, { 'azd-service-name': 'web' })
    containerAppsEnvironmentName: containerAppsStack.outputs.environmentName
    containerRegistryName: containerAppsStack.outputs.registryName
    identityType: 'UserAssigned'
    identityName: managedIdentity.outputs.name
    userAssignedIdentityResourceId: managedIdentity.outputs.resourceId
    principalId: managedIdentity.outputs.principalId
    targetPort: 80
    external: true
    ingressTransport: 'auto'
    containerCpuCoreCount: '0.25'
    containerMemory: '0.5Gi'
    containerMinReplicas: 1
    containerMaxReplicas: 3
    env: [
      { name: 'API_URL', value: 'http://${containerAppApi.outputs.name}.internal.${containerAppsStack.outputs.defaultDomain}' }
    ]
  }
}

// ===================== //
// Azure Monitor: Action Group + Alert Rules
// ===================== //

// Scheduled query rules must be scoped to the Log Analytics workspace — AppRequests /
// AppTraces / AppTraces are workspace tables, not App Insights-native resources.
var logAnalyticsWorkspaceId = resourceId('Microsoft.OperationalInsights/workspaces', monitoring.outputs.logAnalyticsWorkspaceName)

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-${environmentName}-${resourceSuffix}'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: take('ag-${shortName}', 12)
    enabled: true
    emailReceivers: alertEmail != '' ? [
      {
        name: 'primary'
        emailAddress: alertEmail
        useCommonAlertSchema: true
      }
    ] : []
  }
}

// Alert: more than 5 HTTP 5xx errors in any 5-minute window
resource alertHighErrorRate 'Microsoft.Insights/scheduledQueryRules@2022-06-15' = {
  name: 'alert-http-errors-${resourceSuffix}'
  location: location
  tags: tags
  properties: {
    displayName: 'High HTTP Error Rate'
    description: 'More than 5 HTTP 5xx responses in a 5-minute window'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    scopes: [logAnalyticsWorkspaceId]
    criteria: {
      allOf: [
        {
          query: 'AppRequests | where toint(ResultCode) >= 500'
          timeAggregation: 'Count'
          threshold: 5
          operator: 'GreaterThan'
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [actionGroup.id]
    }
    autoMitigate: true
  }
}

// Alert: any individual /conversations/:id/messages request taking longer than 30s
resource alertHighLatency 'Microsoft.Insights/scheduledQueryRules@2022-06-15' = {
  name: 'alert-high-latency-${resourceSuffix}'
  location: location
  tags: tags
  properties: {
    displayName: 'High Chat Latency (> 30s)'
    description: 'A /conversations/:id/messages request exceeded 30 seconds'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    scopes: [logAnalyticsWorkspaceId]
    criteria: {
      allOf: [
        {
          query: 'AppRequests | where Name contains "/messages" | where DurationMs > 5000'
          timeAggregation: 'Count'
          threshold: 0
          operator: 'GreaterThan'
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [actionGroup.id]
    }
    autoMitigate: true
  }
}

// Alert: more than 3 Cosmos DB / conversation-store errors in 5 minutes
resource alertCosmosErrors 'Microsoft.Insights/scheduledQueryRules@2022-06-15' = {
  name: 'alert-cosmos-errors-${resourceSuffix}'
  location: location
  tags: tags
  properties: {
    displayName: 'Cosmos DB Operation Failures'
    description: 'More than 3 conversation-store error log entries in a 5-minute window'
    severity: 1
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    scopes: [logAnalyticsWorkspaceId]
    criteria: {
      allOf: [
        {
          query: 'AppTraces | where SeverityLevel >= 3 | where Message has_any ("Failed to create conversation", "Failed to list conversations", "Failed to get conversation", "Failed to delete conversation", "Conversation message store error")'
          timeAggregation: 'Count'
          threshold: 1
          operator: 'GreaterThan'
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [actionGroup.id]
    }
    autoMitigate: true
  }
}

// Alert: API container restarted more than twice in 5 minutes
resource alertContainerRestart 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-container-restart-${resourceSuffix}'
  location: 'global'
  tags: tags
  properties: {
    description: 'API container app has restarted more than twice in a 5-minute window'
    severity: 1
    enabled: true
    scopes: [resourceId('Microsoft.App/containerApps', containerAppApi.outputs.name)]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'RestartCount'
          metricName: 'RestartCount'
          metricNamespace: 'Microsoft.App/containerApps'
          operator: 'GreaterThan'
          threshold: 2
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
    autoMitigate: false
  }
}

// ===================== //
// Outputs
// ===================== //

output apiContainerAppUrl string = containerAppApi.outputs.uri
output webContainerAppUrl string = containerAppWeb.outputs.uri
output registryLoginServer string = containerAppsStack.outputs.registryLoginServer
output registryName string = containerAppsStack.outputs.registryName
output azureOpenAiEndpoint string = useAzureModel ? openai!.properties.endpoint : ''
output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint
