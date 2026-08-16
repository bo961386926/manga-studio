import React from 'react';
import { MapPin } from 'lucide-react';
import { Scene } from '../../types';

interface Props {
  scenes: Scene[];
}

const SceneList: React.FC<Props> = ({ scenes }) => {
  return (
    <section>
      <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-4 flex items-center gap-2">
        <MapPin className="w-3 h-3" /> 场景列表
      </h3>
      <div className="space-y-1">
        {scenes.map((s) => (
          <div key={s.id} className="flex items-center gap-3 text-xs text-zinc-400 group cursor-default p-2 rounded-xl hover:bg-white/[0.05] transition-colors">
            <div className="w-1.5 h-1.5 bg-zinc-700 rounded-full group-hover:bg-zinc-400 transition-colors"></div>
            <span className="truncate group-hover:text-zinc-200">{s.location}</span>
          </div>
        ))}
      </div>
    </section>
  );
};

export default SceneList;
