# dsh-plugin-video-watermark — Video Watermark

Superpone una marca de agua (imagen) sobre un video con ffmpeg: posicion, opacidad y margen configurables, reencode seguro y guardado confirmado.

## Herramientas

| Tool | Qué hace |
|---|---|
| `status` | Estado |
| `apply` | Aplicar marca de agua |

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-video-watermark` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-video-watermark
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_VIDEO_WATERMARK_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\video-watermark\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
