const core = require('@actions/core');
const fs = require('fs');
const glob = require('@actions/glob');
const path = require('path');
const yaml = require('yaml');

const sha1 = /\b[a-f0-9]{40}\b/i;
const sha256 = /\b[A-Fa-f0-9]{64}\b/i;

async function run() {
  try {
    // DEPRECATION NOTICE
    const deprecationMessage = `⚠️  DEPRECATION NOTICE: This action is deprecated and will be removed in a future version.

GitHub now provides native SHA pinning enforcement. Please migrate to using GitHub's built-in security features instead.

For more information, see:
- Official GitHub Docs: https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions

This action will continue to work for now, but please plan to migrate away from it.`;

    core.warning(deprecationMessage);

    // Add to job summary (only if running in GitHub Actions environment)
    if (process.env.GITHUB_STEP_SUMMARY) {
      try {
        await core.summary
          .addHeading('⚠️ Deprecation Notice')
          .addRaw(`
This action (\`github-actions-ensure-sha-pinned-actions\`) is **deprecated** and will be removed in a future version.

GitHub now provides native SHA pinning enforcement. Please migrate to using GitHub's built-in security features instead.

### Migration Resources

- [Official GitHub Docs](https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions)

### Action
Please plan to migrate away from this action. It will continue to work for now, but support will be discontinued.
          `)
          .write();
      } catch (summaryError) {
        // Silently continue if job summary fails - the warning is the important part
        core.debug('Failed to write job summary: ' + summaryError.message);
      }
    }

    const allowlist = core.getInput('allowlist');
    const isDryRun = core.getInput('dry_run') === 'true';
    const workflowsPath = process.env['ZG_WORKFLOWS_PATH'] || '.github/workflows';
    const globber = await glob.create([workflowsPath + '/*.yaml', workflowsPath + '/*.yml'].join('\n'));
    let actionHasError = false;

    for await (const file of globber.globGenerator()) {
      const basename = path.basename(file);
      const fileContents = fs.readFileSync(file, 'utf8');
      const yamlContents = yaml.parse(fileContents);
      const jobs = yamlContents['jobs'];
      let fileHasError = false;

      if (jobs === undefined) {
        core.setFailed(`The "${basename}" workflow does not contain jobs.`);
      }

      core.startGroup(workflowsPath + '/' + basename);

      for (const job in jobs) {
        const uses = jobs[job]['uses'];
        const steps = jobs[job]['steps'];

        if (assertUsesVersion(uses)) {
          if (!assertUsesSha(uses) && !assertUsesAllowlist(uses, allowlist)) {
            actionHasError = true;
            fileHasError = true;

            reportError(`${uses} is not pinned to a full length commit SHA.`, isDryRun);
          }
        } else if (steps !== undefined) {
          for (const step of steps) {
            const uses = step['uses'];

            if (assertUsesVersion(uses) && !assertUsesSha(uses) && !assertUsesAllowlist(uses, allowlist)) {
              actionHasError = true;
              fileHasError = true;

              reportError(`${uses} is not pinned to a full length commit SHA.`, isDryRun);
            }
          }
        } else {
          core.warning(`The "${job}" job of the "${basename}" workflow does not contain uses or steps.`);
        }
      }

      if (!fileHasError) {
        core.info('No issues were found.')
      }

      core.endGroup();
    }

    if (!isDryRun && actionHasError) {
      throw new Error('At least one workflow contains an unpinned GitHub Action version.');
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();

function assertUsesVersion(uses) {
  return typeof uses === 'string' && uses.includes('@');
}

function assertUsesSha(uses) {
  if (uses.startsWith('docker://')) {
    return sha256.test(uses.substr(uses.indexOf('sha256:') + 7));
  }

  return sha1.test(uses.substr(uses.indexOf('@') + 1));
}

function assertUsesAllowlist(uses, allowlist) {
  if (!allowlist) {
    return false;
  }

  const action = uses.substr(0, uses.indexOf('@'));
  const isAllowed = allowlist.split(/\r?\n/).some((allow) => action.startsWith(allow));

  if(isAllowed) {
    core.info(`${action} matched allowlist — ignoring action.`)
  }

  return isAllowed;
}

function reportError(message, isDryRun) {
  if (isDryRun) {
    core.warning(message);
  } else {
    core.error(message);
  }
}
