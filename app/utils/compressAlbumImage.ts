/** 强制生成 JPEG；透明区域铺白，避免 PNG 被直接改扩展名后上传。 */
export async function compressAlbumImage(file: File, maxSide = 1920, quality = 0.8): Promise<File> {
  const url = URL.createObjectURL(file)
  const image = new Image()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`读取「${file.name}」超时，请重试。`)), 15000)
      image.onload = () => resolve()
      image.onerror = () => reject(new Error(`无法读取「${file.name}」，请使用浏览器支持的 JPG、PNG 或 WebP 图片。`))
      image.src = url
    })
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸无效。')
    const scale = Math.min(1, maxSide / image.naturalWidth, maxSide / image.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法处理图片，请换一个浏览器重试。')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => {
      if (value) resolve(value)
      else reject(new Error(`压缩「${file.name}」失败，请重试。`))
    }, 'image/jpeg', quality))
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, {
      type: 'image/jpeg', lastModified: file.lastModified,
    })
  } finally {
    clearTimeout(timeout)
    image.onload = image.onerror = null
    image.src = ''
    URL.revokeObjectURL(url)
  }
}
