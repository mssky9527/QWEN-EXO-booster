# QWEN-EXO-booster

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

![img](/banner.png)

A Qwen hybrid-attention inference backend built on a **customized SGLang fork**. Its goal is not to stack feature names, but to help Qwen actually retain knowledge, reflect on mistakes, and run fast enough in long tasks.

> Supports macOS and Linux. (Native SGLang is not supported on Windows; WSL is recommended.) Supports Qwen3.5 through Qwen3.8, compatible derivative checkpoints, and MoE models. Qwen3.8-27B is recommended.

## Why QWEN-EXO

### Model-native knowledge injection

Knowledge is connected directly to model attention, so the model can call relevant knowledge when needed instead of first stuffing documents into a long prompt.

You only need to write a Markdown knowledge base. No fine-tuning or retraining is required.

![img](/images/1.png)

### Reflection Memory

The server-side memory system settles task trajectories and distills reusable lessons after successes and failures. When a similar task appears later, the model can reuse earlier lessons instead of starting from zero.

![img](/images/2.png)

### Observability

You can directly inspect which content was recalled, reviewed, and injected in each request, preventing the model from receiving knowledge it should not get.

![img](/images/3.png)

### DeepSWE memory-recall measured GraphQL SWE: converged to a perfect score after 18 rounds

| Round | F2P | P2P | partial | reward | Notes |
|---:|---:|---:|---:|---:|---|
| r1 | 12/17 | 811/811 | 0.993961 | 0 | First round |
| r2 | 3/17 | 810/811 | 0.981884 | 0 | Regression |
| r3 | 13/17 | 811/811 | 0.995169 | 0 | Recovery |
| r4 | 14/17 | 811/811 | 0.996377 | 0 | |
| r6 | 13/17 | 811/811 | 0.995169 | 0 | |
| r8 | 10/17 | 811/811 | 0.991546 | 0 | |
| r9 | 13/17 | 811/811 | 0.995169 | 0 | |
| r10 | 14/17 | 810/811 | 0.995169 | 0 | P2P regression |
| r11 | 16/17 | 811/811 | 0.998792 | 0 | Closest to perfect before r18 |
| r12 | 16/17 | 810/811 | 0.997585 | 0 | P2P regression |
| r13 | 15/17 | 811/811 | 0.997585 | 0 | |
| r14 | 15/17 | 810/811 | 0.996377 | 0 | P2P regression |
| r15 | 15/17 | 810/811 | 0.996377 | 0 | P2P regression |
| r16 | 15/17 | 810/811 | 0.996377 | 0 | P2P regression |
| r17 | 16/17 | 811/811 | 0.998792 | 0 | Final DSL `initialCount` gap |
| r18 | 17/17 | 811/811 | 1.000000 | 1 | Perfect score |

### DFLASH: inference acceleration

QWEN-EXO currently supports the state-of-the-art DFLASH technology. **Qwen3.8-27B is measured at close to 4x token-output acceleration**.

Download address for the 27B inference-acceleration model:

https://huggingface.co/z-lab/Qwen3.8-27B-DFlash2

### Context Integrity (experimental)

Context Integrity is disabled in normal launches. It is allowed only when
`QWEN_EXO_EXPERIMENTAL_CONTEXT_INTEGRITY=1` is set at startup (or when
`--qwen-exo-experimental-context-integrity` is passed).

## Accessing the console

The console listens only on `127.0.0.1` by default. Do not expose it directly to the public Internet.

Create a local tunnel:

```bash
ssh -N -L 30000:127.0.0.1:30000 <gpu-user>@<gpu-host>
```

Open in a browser:

```text
http://127.0.0.1:30000/qwen-exo/
```

Main pages:

- `/qwen-exo/`: chat and running state;
- `/qwen-exo/admin`: operations entry;
- `/qwen-exo/recall-trace`: recall trace;
- **Reflection Memory**: view, re-reflect, and hot-update reusable lessons.

## API quick start

```bash
curl --no-buffer http://127.0.0.1:30000/v1/responses \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "duckgpt",
    "input": "Explain how this service restores hybrid-attention state.",
    "stream": true,
    "max_output_tokens": 256
  }'
```

Query knowledge metadata:

```bash
curl http://127.0.0.1:30000/qwen-exo/knowledge
```

Query recall trace:

```bash
curl 'http://127.0.0.1:30000/qwen-exo/recall-trace?limit=10'
```

Query telemetry:

```bash
curl 'http://127.0.0.1:30000/qwen-exo/telemetry?limit=100'
```

## Local verification

Without loading the production model:

```bash
PYTHONPATH=python python -m pytest test/registered/qwen_exo -q
```

Build the console:

```bash
cd frontend/qwen-exo
npm ci
npm run build
```

GPU preflight:

```bash
python3 scripts/qwen_exo/check_cuda.py
python3 scripts/qwen_exo/check_imports.py
python3 scripts/qwen_exo/check_kernels.py
python3 scripts/qwen_exo/smoke_contracts.py
```

## Apple Silicon

macOS does not require Docker or CUDA. It uses the native MLX path:

```bash
bash scripts/qwen_exo/install_mlx.sh
export QWEN_EXO_MODEL_PATH=/path/to/Qwen3.8-27B
export QWEN_EXO_DATA_PATH=/path/to/qwen-exo-runtime
bash scripts/qwen_exo/launch_mlx.sh
```

For full boundaries, see the [Apple Silicon MLX deployment guide](docs/qwen_exo/APPLE_SILICON_MLX_DEPLOYMENT.md).

## Repository layout

```text
python/qwen_exo_booster/       QWEN-EXO runtime, memory pipeline, Judge, Observer, APIs
python/sglang/                 Customized SGLang code and model/scheduler integration
scripts/qwen_exo/              Build, launch, preflight, smoke, and evaluation tools
scripts/qwen_exo/corpus/knowledge/  Factual and reflection knowledge sources
scripts/qwen_exo/corpus/policydata/  Versioned PolicyData source
scripts/qwen_exo/corpus/cognition/   Optional Cognition source
docker/                        Dockerfile and deployment configuration
frontend/qwen-exo/             React/Vite Chinese console
docs/qwen_exo/                 Architecture, API, deployment, and verification documents
test/registered/qwen_exo/      Registered regression tests
```
