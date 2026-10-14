# Tag W&B runs with their Slurm job

The Cluster jobs tab shows a job's W&B run: the epoch, the metrics from
`ctun.wandb.metrics` and a link to the run. The job's project is the W&B
project of that run. To find the run, the extension looks for the W&B tag
`slurm:<job id>` in every project of the entity. Your training script must add
that tag. The extension
cannot read the script, so it cannot check this for you.

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
    run.tags = (*run.tags, f"slurm:{slurm_job_id}")
```

PyTorch Lightning's `WandbLogger`:

```python
import os
from lightning.pytorch.loggers import WandbLogger

wandb_logger = WandbLogger(project="my_project", id=run_id, resume="allow")
slurm_job_id = os.environ.get("SLURM_JOB_ID")
if slurm_job_id:
    run = wandb_logger.experiment
    run.tags = (*run.tags, f"slurm:{slurm_job_id}")
```

Outside Slurm, `SLURM_JOB_ID` is not set and the script adds no tag.

## 2. Get the change onto the cluster

The job runs the code in the cluster's checkout. Commit and push the change,
then pull it there. Jobs that started before the pull have no tag, and their
Training line says "No W&B run tagged".

## 3. Set up the extension

In the **Setup** view of the ctun sidebar:

- **API key**: run **ctun: Set W&B API Key**. It can open
  [W&B User Settings](https://wandb.ai/settings); under **API Keys**, click
  **New key**, name it, and copy it. W&B shows the full key only once. The
  extension checks the key with W&B, then VS Code keeps it in its
  SecretStorage, never in the settings.
- **Entity**: set `ctun.wandb.entity` only if the projects belong to a team or
  another user. Empty means the API key's own entity.

Then collapse and expand a job in the Cluster jobs tab to look up its run again.

## 4. Tag a job afterwards

A job whose run has no tag shows as Unassigned. To move it into its project,
add the tag `slurm:<job id>` to the run in W&B: open the run, and add the tag
under **Overview** → **Tags**. With the W&B Python API:

```python
import wandb

run = wandb.Api().run("<entity>/<project>/<run id>")
run.tags = [*run.tags, "slurm:4821937"]
run.update()
```

The job moves into the run's project at the next refresh of the Cluster jobs
tab.
