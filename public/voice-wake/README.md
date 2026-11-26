# Hey Kitchen acoustic model

The English/Mandarin Zipformer 3M keyword-spotting model and Emscripten filesystem map come from the [Sherpaw model pack at revision 1770a4b](https://huggingface.co/moeru-ai/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/tree/1770a4b22db32184c110ac43c601db17cc9c93f8). The upstream model is [sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20](https://github.com/k2-fsa/sherpa-onnx/releases/tag/kws-models). Both packaged files are unmodified. See MODEL-LICENSE.txt for the Apache 2.0 license.

| Local file | Source file under install/bin/wasm | SHA-256 |
| --- | --- | --- |
| zipformer-4ca3ae0d.data | preload.data | 4ca3ae0d147df1576fac87a4837f5a8959f4f87600a8306c57cc67eb8b40494d |
| zipformer-e7e22329.json | preload.js.metadata | e7e223298765f02cdc868d8d1af52fd2c0da6aeef2a5af4122489fd7a8ed1e7b |

The authenticated board loads these same-origin assets and the bundled Sherpaw WebAssembly worker when hands-free listening starts. The detector processes short microphone frames on the device and emits a wake event. Home Console discards the frames after processing.
