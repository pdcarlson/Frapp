Review workflow changes like release infrastructure.

- Check for secret exposure in scripts, shell commands, or interpolated values.
- Verify `permissions:` are minimal and match the job's actual needs.
- Confirm `workflow_run` and branch conditions guard production actions correctly.
- Flag renamed jobs or check names unless the branch-protection script and runbooks are updated in the same change.
- Avoid required workflow-level `paths` filters on checks used by protected branches.
