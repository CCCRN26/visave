"use client";
import { useRef } from "react";
export default function SignaturePad({ disabled, onChange }) {
  const canvasRef = useRef(null), drawingRef = useRef(false), pointsRef = useRef(0);
  function point(event) { const canvas = canvasRef.current, rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; }
  function start(event) { if (disabled) return; const canvas = canvasRef.current, ctx = canvas.getContext("2d"), p = point(event); canvas.setPointerCapture(event.pointerId); drawingRef.current = true; pointsRef.current = 0; ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function move(event) { if (!drawingRef.current) return; const ctx = canvasRef.current.getContext("2d"), p = point(event); ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#173839"; ctx.lineTo(p.x, p.y); ctx.stroke(); pointsRef.current += 1; }
  function end() { if (!drawingRef.current) return; drawingRef.current = false; onChange(pointsRef.current >= 8 ? canvasRef.current.toDataURL("image/png") : null); }
  function clear() { const canvas = canvasRef.current; canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); pointsRef.current = 0; onChange(null); }
  return <fieldset className="signature-fieldset" disabled={disabled}><legend>Reconciliation confirmation</legend><p>Sign below to confirm that the physical funds counted match the amounts entered above.</p><canvas ref={canvasRef} width="900" height="240" aria-label="Signature pad" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}/><button type="button" className="button-secondary" onClick={clear}>Clear signature</button></fieldset>;
}
