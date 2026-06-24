using './main.bicep'

// REQUIRED: the merge job image. Push it to your ACR (see .github/workflows/
// deploy.yml) and reference it here, e.g. availcalacr.azurecr.io/availcal:latest
param containerImage = 'REPLACE_WITH_YOUR_REGISTRY/availcal:latest'

// Optional: set to your ACR login server to pull via managed identity.
// param acrLoginServer = 'availcalacr.azurecr.io'

param namePrefix = 'availcal'
param cronExpression = '0 * * * *' // hourly, UTC
param defaultTz = 'America/New_York'
param horizonDays = 90
param includeTentative = true
