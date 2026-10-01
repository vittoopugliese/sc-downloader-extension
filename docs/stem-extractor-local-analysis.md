# Análisis estático del extractor instalado

Fecha: 2026-09-30. Objetivo solicitado: separación íntegramente dentro de Chrome.

## Evidencia local

Directorio inspeccionado: `C:\Users\torib\Documents\Image-Line\Downloads\Optional Features\Stem extractor Windows`.

| Archivo | Bytes | SHA-256 |
| --- | ---: | --- |
| `stemextract.dll` | 358400 | `61de78a23c8677c5a68a8225d59b93523648ba0b083a7493495bc94fc2d71b18` |
| `data.mod` | 98425928 | `9583a59f298c6d023db5333ab0233dfb89733d8f88b08e2ad69dca30614e2fea` |

`stemextract.dll` es un PE de Windows x64 (máquina `0x8664`). Importa `c10.dll`, `torch_cpu.dll` y `KERNEL32.dll`. Exporta:

```text
demucsCreate             demucsCreateData
demucsDestroy            demucsDestroyData
demucsGetLibVersion      demucsInitFromMemory
demucsNumChunks          demucsNumStems
demucsNumStemsEx         demucsPostprocessFull
demucsProcessChunk       demucsSetHqMode
demucsSetInferenceParams demucsSetSelected
setThreads
```

Los nombres permiten identificar una interfaz Demucs con fragmentación, selección y posprocesado. **No determinan las firmas de las funciones**, ni la variante exacta del modelo. No se llamó a estas funciones con argumentos adivinados.

El desensamblado con Capstone añade evidencia más concreta:

- RVA `0x10a60` (`demucsNumStems`): `mov eax, 4; ret`. La función base devuelve cuatro.
- RVA `0x109e0` (`demucsInitFromMemory`): llama a la rutina `0x12de0`.
- RVA `0x12e48`, dentro de esa rutina: llamada importada a `torch::jit::load(std::istream&, optional<Device>, bool)`. El motor espera un módulo TorchScript serializado.
- RVA `0x12e6f`: llamada a `torch::jit::Module::to(Device, bool)`; RVA `0x12e7a`: `Module::train(false)`.

La rutina inspeccionada copia la entrada a un stream antes de cargarla. No se identificó allí la transformación que vuelve utilizable el archivo `data.mod`. No se deduce que el archivo transformado sea necesariamente el mismo módulo único consumido por esta API: también puede contener un envoltorio adicional.

Cadenas locales relevantes: `vocal denoiser (vocals, residual)`, `standard model output`, `add residual into drums`, `add residual into bass`, `add residual into vocals`. Demuestran que esos textos están presentes; por sí solos no documentan el comportamiento ni los parámetros de cada modo.

`data.mod` no presenta una cabecera ZIP legible directamente. Una prueba XOR con la máscara repetida `1dc61e087d65ae54`, inferida de campos inicialmente nulos, recupera al comienzo una cabecera ZIP y nombres como `5cf18e84/` y `.data/`. La transformación deja de producir texto coherente más adelante y **no recupera el directorio central**. Es una pista sobre el contenedor, no una decodificación completa ni un modelo exportado. No se afirma que sea cifrado fuerte ni que se conozca todavía el esquema de transformación.

## Reproducción

```powershell
node scripts/inspect-stem-extractor.cjs 'C:\Users\torib\Documents\Image-Line\Downloads\Optional Features\Stem extractor Windows'
```

El inspector lee los archivos, calcula hashes, enumera exportaciones/importaciones PE y busca un contenedor ZIP. No carga las DLL, ejecuta pickle ni copia pesos al paquete de la extensión. Está pensado para estos artefactos locales, no como parser endurecido para archivos hostiles.

Desensamblado reproducible (Python con `capstone==5.0.9` y `pefile==2024.8.26`; también se busca en `%TEMP%/stem-analysis-python`):

```powershell
python scripts/disassemble-stem-extractor.py 'C:\Users\torib\Documents\Image-Line\Downloads\Optional Features\Stem extractor Windows\stemextract.dll' --rva 0x12de0 --bytes 195
```

Comprobaciones realizadas: ejecución del inspector sobre ambos archivos, comprobación de sintaxis Node, y desensamblado de la rutina de inicialización con resolución de las llamadas importadas. No son pruebas de separación de audio.

## Estado del port

Actualización al cierre de la sesión: se implementó y verificó una **alternativa con HTDemucs público dentro de Chrome**, documentada en [loop-stems.md](loop-stems.md). Las limitaciones que siguen se refieren exclusivamente a reconstruir el modelo original de Image-Line.

Pendiente: recuperar el contenedor completo, identificar grafo/pesos y contrato de audio, convertir a un formato ejecutable en navegador, reproducir el procesamiento y comprobar stems reales en Chrome. No hay aún un separador reconstruido o integrado. El manifest existente permite WASM mediante `wasm-unsafe-eval`; eso no hace ejecutable una DLL ni un modelo PyTorch.

Ver [viabilidad y fuentes oficiales](stem-extractor-browser-feasibility.md) para la ruta JavaScript + ONNX Runtime Web y los criterios de validación.
