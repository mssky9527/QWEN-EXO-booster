# QWEN-EXO-booster

<p align="center">
  <strong>简体中文</strong> · <a href="README_EN.md">English</a>
</p>

![img](/banner.png)

基于 **SGLang 二次开发**的 Qwen 混合注意力推理后端。我们的目标不是堆功能名，而是让 Qwen 在长任务里真正记住知识、反思错误，并且跑得足够快。

> 支持 macOS 和 Linux。(Windows 原生 SGLang 暂不支持，建议用 WSL)。支持 Qwen3.5 到 Qwen3.8 以及兼容的二次修改模型，也支持 MoE。建议优先使用 Qwen3.8-27B。

## 为什么是 QWEN-EXO

### 原生知识库注入

把知识直接接进模型注意力：让模型在需要时调用相关知识，而不是先把文档塞进长 prompt。

你只需要写 Markdown 知识库，不需要微调，也不需要重新训练。

![img](/images/1.png)

### 反思记忆

服务端会沉淀任务轨迹，在成功和失败后提炼可复用经验。下一次遇到相似任务时，模型能复用前面的教训，而不是每次都从零开始。

![img](/images/2.png)

### 可观测性

你可以直接查看一次请求里到底召回、审查并注入了哪些内容，防止模型拿到不该拿的知识。

![img](/images/3.png)

### deepswe记忆召回实测GraphQL SWE：18 轮收敛到满分

| 轮次 | F2P | P2P | partial | reward | 备注 |
|---:|---:|---:|---:|---:|---|
| r1 | 12/17 | 811/811 | 0.993961 | 0 | 首轮 |
| r2 | 3/17 | 810/811 | 0.981884 | 0 | 回归 |
| r3 | 13/17 | 811/811 | 0.995169 | 0 | 恢复 |
| r4 | 14/17 | 811/811 | 0.996377 | 0 | |
| r6 | 13/17 | 811/811 | 0.995169 | 0 | |
| r8 | 10/17 | 811/811 | 0.991546 | 0 | |
| r9 | 13/17 | 811/811 | 0.995169 | 0 | |
| r10 | 14/17 | 810/811 | 0.995169 | 0 | P2P 回归 |
| r11 | 16/17 | 811/811 | 0.998792 | 0 | 最接近满分 |
| r12 | 16/17 | 810/811 | 0.997585 | 0 | P2P 回归 |
| r13 | 15/17 | 811/811 | 0.997585 | 0 | |
| r14 | 15/17 | 810/811 | 0.996377 | 0 | P2P 回归 |
| r15 | 15/17 | 810/811 | 0.996377 | 0 | P2P 回归 |
| r16 | 15/17 | 810/811 | 0.996377 | 0 | P2P 回归 |
| r17 | 16/17 | 811/811 | 0.998792 | 0 | 最后差 DSL `initialCount` |
| r18 | 17/17 | 811/811 | 1.000000 | 1 | 满分 |

### DFLASH：推理加速
目前QWEN-EXO支持最先进的DFLASH技术, **QWEN3.8-27B实测已经接近 4 倍token输出**
27b推理加速模型下载地址:
https://huggingface.co/z-lab/Qwen3.8-27B-DFlash2

### Context Integrity（实验功能）

Context Integrity 默认下线，不会随普通启动加载。只有启动时显式设置
`QWEN_EXO_EXPERIMENTAL_CONTEXT_INTEGRITY=1`（或传入
`--qwen-exo-experimental-context-integrity`）才允许启用。


## 访问控制台

控制台默认只监听 `127.0.0.1`，不要直接暴露到公网。

在本地建立隧道：

```bash
ssh -N -L 30000:127.0.0.1:30000 <gpu-user>@<gpu-host>
```

浏览器打开：

```text
http://127.0.0.1:30000/qwen-exo/
```

主要页面：

- `/qwen-exo/`：对话和运行状态；
- `/qwen-exo/admin`：运维入口；
- `/qwen-exo/recall-trace`：召回轨迹；
- “反思记忆”：查看、重新反思和热更新经验。

## API 快速示例

```bash
curl --no-buffer http://127.0.0.1:30000/v1/responses \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "duckgpt",
    "input": "解释当前服务的混合注意力状态如何恢复。",
    "stream": true,
    "max_output_tokens": 256
  }'
```

查询知识库：

```bash
curl http://127.0.0.1:30000/qwen-exo/knowledge
```

查询召回轨迹：

```bash
curl 'http://127.0.0.1:30000/qwen-exo/recall-trace?limit=10'
```

查询遥测：

```bash
curl 'http://127.0.0.1:30000/qwen-exo/telemetry?limit=100'
```

## 本地验证

不加载线上模型时：

```bash
PYTHONPATH=python python -m pytest test/registered/qwen_exo -q
```

构建控制台：

```bash
cd frontend/qwen-exo
npm ci
npm run build
```

GPU 预检：

```bash
python3 scripts/qwen_exo/check_cuda.py
python3 scripts/qwen_exo/check_imports.py
python3 scripts/qwen_exo/check_kernels.py
python3 scripts/qwen_exo/smoke_contracts.py
```

## Apple Silicon

macOS 不需要 Docker 或 CUDA，走原生 MLX 链路：

```bash
bash scripts/qwen_exo/install_mlx.sh
export QWEN_EXO_MODEL_PATH=/path/to/Qwen3.8-27B
export QWEN_EXO_DATA_PATH=/path/to/qwen-exo-runtime
bash scripts/qwen_exo/launch_mlx.sh
```

完整边界见 [Apple Silicon MLX 部署指南](docs/qwen_exo/APPLE_SILICON_MLX_DEPLOYMENT.md)。

## 目录说明

```text
python/qwen_exo_booster/       QWEN-EXO runtime、记忆管线、Judge、Observer、API
python/sglang/                 SGLang 二开和模型/scheduler 集成
scripts/qwen_exo/              构建、启动、预检、smoke 和评测工具
scripts/qwen_exo/corpus/knowledge/  事实知识与反思知识源
scripts/qwen_exo/corpus/policydata/ 版本化 PolicyData 源文件
scripts/qwen_exo/corpus/cognition/   可选 Cognition 源文件
docker/                        Dockerfile 和部署配置
frontend/qwen-exo/             React/Vite 中文控制台
docs/qwen_exo/                 架构、API、部署和验证文档
test/registered/qwen_exo/      注册回归测试
```
