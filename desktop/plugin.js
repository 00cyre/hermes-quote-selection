import { host } from '@hermes/plugin-sdk'

// A local renderer-only affordance. Nothing is sent, logged, or copied to the clipboard.
const bodies = '[data-slot="aui_assistant-message-content"], [data-slot="aui_user-message-root"]'
const editable = 'textarea,input,[contenteditable="true"],[role="textbox"]'
const elementOf = n => n?.nodeType === 1 ? n : n?.parentElement
const sessionOf = surface => {
  const anchor = surface?.dataset.sessionAnchor
  if (anchor === 'workspace') return host.state.activeSessionId.get()
  return anchor?.startsWith('session-tile:') ? anchor.slice('session-tile:'.length) : null
}

export default {
  id: 'quote-selection', name: 'Quote in reply',
  description: 'Highlight a passage in chat and add it to your reply, with an optional comment.',
  register(ctx) {
    const box = document.createElement('div')
    box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Reply to selection')
    box.style.cssText = 'position:fixed;z-index:1000;box-sizing:border-box;width:min(310px,calc(100vw - 16px));padding:8px 10px;border:1px solid var(--border);border-radius:12px;background:var(--popover,var(--card,Canvas));color:var(--popover-foreground,var(--foreground,CanvasText));box-shadow:0 4px 18px color-mix(in srgb,currentColor 15%,transparent);font:inherit;font-size:13px;-webkit-app-region:no-drag'
    const preview = document.createElement('div')
    preview.style.cssText = 'border-inline-start:2px solid var(--ui-accent,currentColor);padding-inline-start:7px;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted-foreground);font-size:12px'
    const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:8px'
    const note = document.createElement('input'); note.type='text'; note.placeholder='Add a comment…'; note.setAttribute('aria-label','Optional quote comment'); note.style.cssText='flex:1;min-width:0;font:inherit;color:inherit;background:transparent;border:0;padding:3px'
    const button = document.createElement('button'); button.type='button'; button.textContent='Quote in reply'; button.style.cssText='border:1px solid var(--border);border-radius:7px;padding:4px 8px;background:var(--secondary,ButtonFace);color:var(--secondary-foreground,ButtonText);font:inherit;cursor:pointer;white-space:nowrap'
    row.append(note,button); box.append(preview,row)
    let picked=null, frame=0, dragging=false, writing=false
    const close=()=>{cancelAnimationFrame(frame);frame=0;picked=null;box.remove();preview.textContent='';note.value=''}
    function refresh() {
      frame=0
      if (dragging || writing || box.contains(document.activeElement)) return
      const sel=window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount!==1) return close()
      const range=sel.getRangeAt(0), start=elementOf(range.startContainer), end=elementOf(range.endContainer)
      const body=start?.closest(bodies), surface=body?.closest('[data-chat-surface]')
      if (!body || !surface || end?.closest(bodies)!==body || start.closest(editable) || end.closest(editable)) return close()
      const id=sessionOf(surface), text=sel.toString().replace(/\r\n?/g,'\n')
      if (!id || !text.trim()) return close()
      const rect=range.getBoundingClientRect(), bounds=surface.getBoundingClientRect()
      const top=Math.max(0,bounds.top,rect.top), bottom=Math.min(innerHeight,bounds.bottom,rect.bottom)
      if (bottom<=top || !rect.width || surface.closest('[data-pane-hidden]')) return close()
      if (!picked || picked.text!==text || picked.body!==body) note.value=''
      picked={text,id,body,surface}; preview.textContent=text.replace(/\s+/g,' ').trim()
      if (!box.isConnected) document.body.append(box)
      const width=box.offsetWidth, height=box.offsetHeight
      box.style.left=`${Math.max(8,Math.min(innerWidth-width-8,(rect.left+rect.right-width)/2))}px`
      box.style.top=`${Math.max(8,Math.min(innerHeight-height-8, top>height+8 ? top-height-6 : bottom+6))}px`
    }
    const schedule=()=>{if (!frame) frame=requestAnimationFrame(refresh)}
    async function add() {
      if (!picked || writing) return
      const {id,body,surface,text}=picked
      if (!body.isConnected || surface.closest('[data-pane-hidden]') || sessionOf(surface)!==id) return close()
      const block=text.split('\n').map(s=>s ? '> '+s : '>').join('\n')+'\n\n'+note.value.trim()
      writing=true; button.disabled=true
      try {
        const ok=await host.composer.insertText(id,block,{mode:'block'})
        if (ok) close()
        else host.notify({kind:'info',message:'That chat’s reply box is not available. Nothing was inserted.'})
      } catch {host.notify({kind:'error',message:'Could not add the quote to the draft.'})}
      finally {writing=false;button.disabled=false}
    }
    ctx.addEventListener(document,'pointerdown',e=>{if(!box.contains(e.target)){close();dragging=true}},true)
    ctx.addEventListener(window,'pointerup',()=>{dragging=false;schedule()},true)
    ctx.addEventListener(window,'pointercancel',()=>{dragging=false;close()},true)
    ctx.addEventListener(document,'selectionchange',schedule)
    ctx.addEventListener(document,'scroll',()=>{if(picked && !box.contains(document.activeElement)) schedule()},true)
    ctx.addEventListener(window,'resize',schedule)
    ctx.addEventListener(window,'blur',()=>{dragging=false;close()})
    ctx.addEventListener(document,'keydown',e=>{
      if (e.key==='Escape' && picked && !e.isComposing) { e.preventDefault();e.stopPropagation();close() }
      else if(e.target===note && e.key==='Enter' && !e.isComposing){e.preventDefault();e.stopPropagation();void add()}
    },true)
    ctx.addEventListener(button,'mousedown',e=>e.preventDefault())
    ctx.addEventListener(button,'click',()=>void add())
    ctx.onDispose(close)
  }
}
