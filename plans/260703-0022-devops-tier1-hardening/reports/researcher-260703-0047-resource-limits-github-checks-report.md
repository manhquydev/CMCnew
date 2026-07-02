# Tier-1 Hardening: Resource Limits & GitHub Checks — Research Report

## 1. Docker Compose Resource Limits (4vCPU / 8GB VPS)

**YAML syntax** [Docker Compose Spec](https://docs.docker.com/reference/compose-file/deploy/):
```yaml
deploy:
  resources:
    limits:
      cpus: '1.0'      # decimal cores
      memory: 512M     # hard ceiling
    reservations:
      cpus: '0.25'     # guaranteed allocation
      memory: 256M     # soft target
```

**Conservative baseline for small VPS** [OneUptime](https://oneuptime.com/blog/post/2026-02-02-docker-resource-limits/view):
- **Postgres**: limits 2GB / reservations 1GB; cpu 1.0 / 0.5
- **Node.js API**: limits 1GB / reservations 512M; cpu 0.75 / 0.25
- **nginx**: limits 256M / reservations 128M; cpu 0.25 / 0.1
- **Headroom rule**: Leave 20–30% of host RAM unallocated for OS, Docker daemon, and buffer

**Failure modes** [Docker Resource Constraints](https://docs.docker.com/engine/containers/resource_constraints/):
- **Memory**: OOMKilled (hard limit, process terminates)
- **CPU**: Throttled (soft limit, process slowed, does not terminate)

**Risk**: If container `limits` sum > 8GB, host-level OOMKiller may terminate critical services, ignoring Docker's isolation.

---

## 2. Jenkins publishChecks GitHub Integration

**Credential type** [Jenkins Checks API Plugin](https://www.jenkins.io/blog/2020/08/03/github-checks-api-plugin-coding-phase-2/):
- GitHub Personal Access Token (PAT) with scopes:
  - `repo` (all sub-options: `repo:status`, `repo_deployment`, `public_repo`)
  - `admin:org_hook` (for webhook management)
- Alternative: GitHub App (preferred, narrower permissions) [GitHub App Auth](https://docs.cloudbees.com/docs/cloudbees-ci/latest/cloud-admin-guide/github-app-auth)

**CASC support**: Unclear from plugin docs. GitHub credential setup likely requires **manual UI step** to create/store the credential in Jenkins. Once stored, `credentialsId` can be referenced in Jenkinsfile.

**Jenkinsfile syntax** [Checks API Issue #103](https://github.com/jenkinsci/checks-api-plugin/issues/103):
```groovy
publishChecks name: 'Tier-1 Gate', status: 'IN_PROGRESS', credentialsId: 'github-pat'
// ... later ...
publishChecks name: 'Tier-1 Gate', status: 'COMPLETED', conclusion: 'SUCCESS', credentialsId: 'github-pat'
```

---

## 3. GitHub Branch Protection Required Status Checks (CLI)

**Fully scriptable via `gh api`** [GitHub CLI Guide](https://garrett.dev/2023/07/19/github-cli-programmatically-disabling-and-enabling-branch-protection-rules/):
```bash
gh api --method PUT repos/owner/repo/branches/main/protection \
  --input - <<EOF
{"required_status_checks": {"strict": true, "contexts": ["Tier-1 Gate"]}, ...}
EOF
```

**Modern approach**: Use Rulesets (replaces Classic Protection, API-first):
```bash
gh api repos/owner/repo/rulesets --method POST --input ruleset.json
```

**No manual UI required**: Entire branch protection workflow can be scripted end-to-end.

---

## Unresolved Questions

1. Does Jenkins publishChecks require the target repo to be managed by a GitHub App installed on that repo, or can a PAT-only credential work?
2. For CASC, can credentials be seeded via `casc.yaml`, or must the credential be manually stored?
3. Rulesets vs. Classic Protection: which is recommended for Jenkins integration in 2026?
