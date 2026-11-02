# Cursy-Model: Local-Friendly AI Recipes (GTX 4060)

Goal: Practical, low-VRAM finetune/serve recipes for code, image, and short video/motion on a single 8GB GTX 4060. Favor small models, LoRA/QLoRA, quantization, and on-device inference.

## Tracks

1) Coding Assistant (LLM)
2) Image Generation (SD 1.5 LoRA; optional SDXL if you can tolerate slower runs)
3) Short Motion/Video (AnimateDiff over SD base; avoid full T2V training)

---

## 1) Coding Assistant (LLM)

- Base models: `Mistral 7B Instruct`, `Llama 3 8B Instruct`, or `DeepSeek Coder 6.7B`. Choose one; start with Mistral 7B for speed/quality.
- Finetune: QLoRA (4/8-bit) with `peft` + `trl` (or `unsloth` for speed).
- Data: your repos, stack traces, Q&A. Keep it domain-specific; avoid huge generic mixtures.
- Hyperparams (starter):
  - bnb 4-bit, LoRA r=16, alpha=32, dropout=0.05
  - seq len 4k–8k; bs=1–2 with grad accumulation to fit 8GB
  - lr: 2e-4 LoRA; epochs: 3–5; warmup 2–3%
  - optimizer: paged AdamW, weight decay 0.01
- Serve: quantize to GGUF (`q4_k_m` or `q5_1`) and run via `llama.cpp`/`ollama` for low-latency local use.
- RAG: pair with `bge-small-en` or `gte-small` embeddings + `faiss`/`sqlite` for retrieval; keep context modest.

## 2) Image Generation (SD 1.5 LoRA)

- Base: `Stable Diffusion 1.5` (fastest on 8GB). SDXL works but slower; start with 1.5.
- Finetune: DreamBooth/LoRA via `kohya_ss`, `diffusers`, or ComfyUI LoRA nodes.
- Hyperparams (starter for LoRA):
  - resolution 512–640 (1.5), batch 1–2, epochs 6–10 (low overfit)
  - lr: 1e-4, network dim (rank) 4–16, alpha same or 2× rank
  - text encoder LR lower (e.g., 5e-5), UNet LR 1e-4
  - use prior preservation if subject-specific
- Inference: use ControlNet (canny/depth/pose) + your LoRA stack for control; clip skip 2; sampler DPM++ 2M Karras; steps 20–30.

## 3) Short Motion / Video

- Avoid full T2V training on 8GB. Use AnimateDiff (or Hotshot-XL if using SDXL base) with your SD/LoRA for motion.
- Workflow: render short clips (8–16 frames) at lower res, then upscale with RealESRGAN/TVAI.
- Training: train only LoRAs on the SD base for your style/subject; reuse AnimateDiff motion modules (no heavy finetune).

---

## Tooling & Runtimes
- LLM finetune: `unsloth` (fast QLoRA), or `trl` + `peft` + `bitsandbytes`.
- Inference: `ollama` or `llama.cpp` for LLMs; ComfyUI/Automatic1111 for SD; AnimateDiff node for motion.
- Optimizations: xformers/FlashAttention (if supported), gradient checkpointing, low-rank LoRA, 4-bit loading for train, GGUF for serve.

---

## Example Commands (LLM QLoRA, sketch)

```bash
# env
pip install torch==2.1.2+cu118 transformers peft trl bitsandbytes datasets accelerate

# run (pseudo)
python train.py \
  --model mistralai/Mistral-7B-Instruct-v0.2 \
  --dataset /path/to/jsonl \
  --lora_r 16 --lora_alpha 32 --lora_dropout 0.05 \
  --load_in_4bit \
  --per_device_train_batch_size 1 \
  --gradient_accumulation_steps 8 \
  --lr 2e-4 --num_train_epochs 3 \
  --max_seq_length 4096 \
  --save_steps 500 --output_dir ./out-lora
```

Serve with `ollama` or `llama.cpp` after converting to GGUF.

---

## Example Commands (SD1.5 LoRA, kohya_ss style, sketch)

```bash
accelerate launch train_network.py \
  --pretrained_model_name_or_path=runwayml/stable-diffusion-v1-5 \
  --train_data_dir=/path/to/images \
  --resolution=512 \
  --network_module=networks.lora \
  --network_dim=8 --network_alpha=16 \
  --learning_rate=1e-4 \
  --text_encoder_lr=5e-5 \
  --train_batch_size=1 \
  --max_train_epochs=8 \
  --save_every_n_epochs=2 \
  --mixed_precision=bf16 \
  --enable_xformers_memory_efficient_attention
```

---

## Suggested Base Picks (quick list)
- Code: Mistral 7B Instruct (or Llama 3 8B Instruct), DeepSeek Coder 6.7B if code-heavy.
- Embeddings: `bge-small-en` (or `gte-small`).
- Images: SD 1.5 base; SDXL only if you’re okay with slower gen.
- Motion: AnimateDiff with SD base + your LoRA; short clips only.

---

## Tips
- Keep batches tiny; use grad accumulation.
- Use LoRA over full finetune; cheaper, faster, portable.
- Quantize for serving; keep a FP16 safetensor for future merges.
- Log VRAM; if OOM, reduce rank, resolution, or context.

