#!/usr/bin/env bash
# Deploy AvailCal infrastructure to a resource group.
#
# Prereqs: az CLI logged in (`az login`), and the merge image already pushed to
# a registry referenced by infra/main.bicepparam (containerImage).
#
# Usage:
#   ./deploy.sh <resource-group> [location] [param-overrides...]
# Example:
#   ./deploy.sh availcal-rg eastus containerImage=availcalacr.azurecr.io/availcal:v1
set -euo pipefail

RG="${1:?usage: deploy.sh <resource-group> [location] [key=value ...]}"
LOCATION="${2:-eastus}"
shift || true
shift || true

HERE="$(cd "$(dirname "$0")" && pwd)"

echo "Ensuring resource group '$RG' in '$LOCATION'..."
az group create --name "$RG" --location "$LOCATION" --output none

echo "Validating Bicep..."
az bicep build --file "$HERE/main.bicep"

echo "Deploying..."
az deployment group create \
  --resource-group "$RG" \
  --template-file "$HERE/main.bicep" \
  --parameters "$HERE/main.bicepparam" \
  ${@:+--parameters "$@"} \
  --output table

echo
echo "Done. Next steps:"
echo "  * Upload sources.toml and feed secrets into Key Vault (see docs/RUNBOOK.md)."
echo "  * The job runs hourly; trigger a one-off run with:"
echo "      az containerapp job start --resource-group $RG --name availcal-merge"
