# Tag W&B runs with their Slurm job

The W&B add-on shows a Training line in a job's details: the epoch, the
metrics from `ctun.addons.wandb.metrics` and a link to the run. With
`ctun.projects.source` set to `wandb`, the job's project is the W&B project of
that run, and a run group (`wandb.init(group=...)`) nests below it: a run in
group `lr-sweep` of project `htfm` belongs to `htfm › lr-sweep`. To find the
run, the add-on looks for the tag `slurm:<ClusterName>:<job id>` in every
project of the entity, for example `slurm:haic:4821937`. Your training script
must add that tag. The extension cannot read the script, so it cannot check
this for you.

The cluster name is Slurm's own `ClusterName`, not the name in your ctun
config: on HAICORE it is `haic`. Two clusters can hand out the same job ID, and
the cluster name tells those jobs apart.

## 1. Add the tag after the run starts

Add the tag after `wandb.init`, and append it to the existing tags. Do not pass
it as `tags=` to `init`. A resumed run then keeps the tags of its earlier jobs,
so every job of the run finds it.

Plain `wandb`:

```python
import os
import wandb

run = wandb.init(project="my_project", id=run_id, resume="allow")
slurm_job_id = os.environ.get("SLURM_JOB_ID")
if slurm_job_id:
    slurm_cluster = os.environ["SLURM_CLUSTER_NAME"]
    run.tags = (*run.tags, f"slurm:{slurm_cluster}:{slurm_job_id}")
```

PyTorch Lightning's `WandbLogger`:

```python
import os
from lightning.pytorch.loggers import WandbLogger

wandb_logger = WandbLogger(project="my_project", id=run_id, resume="allow")
slurm_job_id = os.environ.get("SLURM_JOB_ID")
if slurm_job_id:
    slurm_cluster = os.environ["SLURM_CLUSTER_NAME"]
    run = wandb_logger.experiment
    run.tags = (*run.tags, f"slurm:{slurm_cluster}:{slurm_job_id}")
```

Outside Slurm, `SLURM_JOB_ID` is not set and the script adds no tag.

Runs tagged with the older `slurm:<job id>` still match, on any cluster. When
a run with the cluster tag exists, it wins.

## 2. Get the change onto the cluster

The job runs the code in the cluster's checkout. Commit and push the change,
then pull it there. Jobs that started before the pull have no tag, and their
Training line says "No W&B run tagged".

## 3. Set up the extension

In the **Setup** view of the ctun sidebar:

- **W&B**: click the grey row to turn on the add-on
  (`ctun.addons.wandb.enabled`).
- **API key**: run **ctun: Set W&B API Key**. It can open
  [W&B User Settings](https://wandb.ai/settings); under **API Keys**, click
  **New key**, name it, and copy it. W&B shows the full key only once. The
  extension checks the key with W&B, then VS Code keeps it in its
  SecretStorage, never in the settings.
- **Entity**: set `ctun.addons.wandb.entity` only if the projects belong to a
  team or another user. Empty means the API key's own entity. The add-on
  searches the entity's first 100 projects.
- **Projects**: set `ctun.projects.source` to `wandb` to group the jobs by
  their W&B project.

Then collapse and expand a job in the Cluster jobs tab to look up its run again.

## 4. Tag a job afterwards

With W&B as the project source, a job whose run has no tag shows as
Unassigned. To move it into its project, add the tag
`slurm:<ClusterName>:<job id>` to the run in W&B: open the run, and add the tag
under **Overview** → **Tags**. With the W&B Python API:

```python
import wandb

run = wandb.Api().run("<entity>/<project>/<run id>")
run.tags = [*run.tags, "slurm:haic:4821937"]
run.update()
```

The job moves into the run's project at the next refresh of the Cluster jobs
tab.
