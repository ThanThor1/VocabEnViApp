import React from 'react'

export default function ChooseFileModal({ tree, onClose, onChoose }: any){
  const files: string[] = []
  function walk(nodes:any[]){
    for(const n of nodes){
      if (n.type==='file') files.push(n.path)
      if (n.children) walk(n.children)
    }
  }
  walk(tree)

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40">
      <div className="bg-white p-4 w-96 rounded">
        <h3 className="font-semibold mb-2">Choose target file</h3>
        <div className="max-h-64 overflow-auto">
          {files.map((f,i)=> (
            <div key={i} className="p-2 border-b cursor-pointer" onClick={()=>onChoose(f)}>{f}</div>
          ))}
        </div>
        <div className="mt-2 text-right">
          <button className="px-3 py-1" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
