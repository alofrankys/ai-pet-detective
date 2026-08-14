const PHOTO_MIME_BY_EXTENSION=Object.freeze({
  '.jpeg':'image/jpeg',
  '.jpg':'image/jpeg',
  '.heic':'image/heic',
  '.heif':'image/heif',
  '.png':'image/png',
  '.webp':'image/webp'
})

const SUPPORTED_PHOTO_MIMES=new Set(Object.values(PHOTO_MIME_BY_EXTENSION))
const GENERIC_BINARY_MIMES=new Set(['','application/octet-stream','binary/octet-stream'])

function normalizedMime(file){
  const declared=String(file?.type||'').split(';')[0].trim().toLowerCase()
  if(declared==='image/jpg')return 'image/jpeg'
  return declared
}

function extensionFor(name){
  const match=/\.[^.]+$/.exec(String(name||'').trim().toLowerCase())
  return match?.[0]||''
}

function effectivePhotoType(file){
  const declared=normalizedMime(file)
  if(SUPPORTED_PHOTO_MIMES.has(declared))return declared
  if(!GENERIC_BINARY_MIMES.has(declared))return ''
  return PHOTO_MIME_BY_EXTENSION[extensionFor(file?.name)]||''
}

/** Accept non-empty JPEG, HEIC/HEIF, PNG and WebP File-like values without reading their data. */
export function isSupportedPhotoFile(file){
  const size=Number(file?.size)
  return Number.isFinite(size)&&size>0&&Boolean(effectivePhotoType(file))
}

/** Keep supported files in the exact order supplied by the picker or drop event. */
export function filterSupportedPhotoFiles(files){
  return Array.from(files||[]).filter(isSupportedPhotoFile)
}

/**
 * Build a DOM-free photo selection. Object URLs are intentionally not created here.
 * `type` is normalized and, when a picker omits it, inferred from a supported suffix.
 */
export function createPhotoSelection(files){
  return {
    items:filterSupportedPhotoFiles(files).map(file=>({
      file,
      name:String(file.name||'Untitled photo'),
      type:effectivePhotoType(file),
      size:Number(file.size)
    })),
    index:0
  }
}

export function clampPhotoIndex(index,itemCount){
  const last=Math.max(0,Math.trunc(Number(itemCount)||0)-1)
  const numeric=Number(index)
  if(Number.isNaN(numeric))return 0
  if(numeric===Infinity)return last
  if(numeric===-Infinity)return 0
  return Math.min(last,Math.max(0,Math.trunc(numeric)))
}

function assertSelection(selection){
  if(!selection||!Array.isArray(selection.items))throw new TypeError('A photo selection is required')
}

/** Mutate the selection and return its clamped numeric index. */
export function selectPhotoIndex(selection,index){
  assertSelection(selection)
  selection.index=clampPhotoIndex(index,selection.items.length)
  return selection.index
}

/** Move relative to the current item, clamp at both ends, and return the new index. */
export function movePhotoIndex(selection,delta){
  assertSelection(selection)
  const step=Number(delta)
  return selectPhotoIndex(selection,Number(selection.index||0)+(Number.isNaN(step)?0:step))
}

export function photoCounter(selection){
  assertSelection(selection)
  const total=selection.items.length
  return total===0?'0 / 0':`${clampPhotoIndex(selection.index,total)+1} / ${total}`
}

/**
 * Own at most one object URL. Replacing a file revokes the previous URL; selecting
 * the same File again reuses it. `clear()` is idempotent and should run on teardown.
 */
export function createObjectUrlLease({
  createObjectURL=globalThis.URL?.createObjectURL?.bind(globalThis.URL),
  revokeObjectURL=globalThis.URL?.revokeObjectURL?.bind(globalThis.URL)
}={}){
  if(typeof createObjectURL!=='function'||typeof revokeObjectURL!=='function'){
    throw new TypeError('Object URL create and revoke functions are required')
  }
  let leasedFile=null
  let leasedUrl=null

  return {
    replace(file){
      if(!file)throw new TypeError('A photo file is required')
      if(file===leasedFile&&leasedUrl)return leasedUrl

      const nextUrl=createObjectURL(file)
      if(typeof nextUrl!=='string'||!nextUrl)throw new TypeError('Object URL creation failed')

      const previousUrl=leasedUrl
      leasedFile=file
      leasedUrl=nextUrl
      if(previousUrl)revokeObjectURL(previousUrl)
      return nextUrl
    },
    clear(){
      const previousUrl=leasedUrl
      leasedFile=null
      leasedUrl=null
      if(previousUrl)revokeObjectURL(previousUrl)
    }
  }
}
