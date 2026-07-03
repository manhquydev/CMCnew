#!/usr/bin/env bash
# One-time, interactive, operator-run: add "continuous-integration/jenkins/pr-head" as a required
# status check on `main` WITHOUT clobbering any existing branch protection. The GitHub
# branch-protection PUT endpoint replaces the whole protection object, so this reads current
# state first and merges in only the new required check.
#
# NOTE (2026-07-03): the custom Jenkinsfile "CMCnew CI" publishChecks step never reliably posts
# (root cause not found — investigated via Jenkins system log + strategyId fix, still silent).
# "continuous-integration/jenkins/pr-head" is Jenkins' own github-branch-source plugin status,
# confirmed on real PRs this session to flip pending→success on green and pending→error on a
# deliberately broken red build (plans/260703-0933-action-plan-known-issues/phase-03). Use this
# context instead.
#
# Do NOT run this until the check context has been proven to post reliably on a real PR — enabling
# a required check that never posts will block ALL PRs.
#
#   gh auth login   (needs admin on the repo)
#   bash scripts/setup-github-required-check.sh
set -euo pipefail

REPO="manhquydev/CMCnew"
CONTEXT="continuous-integration/jenkins/pr-head"

current=$(gh api "repos/${REPO}/branches/main/protection" 2>/dev/null || echo '{}')

echo "Current branch protection for main:"
echo "$current" | jq .
read -p "Proceed and ADD '${CONTEXT}' as a required check, preserving the above? [y/N] " ok
[ "$ok" = "y" ] || { echo "aborted"; exit 1; }

new_body=$(echo "$current" | jq --arg ctx "$CONTEXT" '{
  required_status_checks: { strict: true, contexts: ([$ctx] + ((.required_status_checks.contexts // []) - [$ctx])) },
  enforce_admins: (.enforce_admins.enabled // false),
  required_pull_request_reviews: .required_pull_request_reviews,
  restrictions: .restrictions
}')

gh api --method PUT "repos/${REPO}/branches/main/protection" --input - <<< "$new_body"

echo "✓ '${CONTEXT}' added as a required status check on main."
