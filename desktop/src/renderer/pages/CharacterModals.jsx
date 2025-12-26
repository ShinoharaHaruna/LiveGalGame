import { useEffect, useState } from 'react';

export function AddCharacterModal({ onClose, onSaved }) {
  const [formData, setFormData] = useState({
    name: '',
    nickname: '',
    relationship_label: '',
    avatar_color: '#ff6b6b',
    affinity: 50,
    notes: ''
  });
  const [loading, setLoading] = useState(false);
  const labelClass = 'block text-sm font-semibold text-pink-100/90 mb-2.5 tracking-wide';
  const inputClass = 'w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all duration-200 backdrop-blur-sm';
  const accentTextClass = 'text-sm font-semibold text-pink-200';

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      alert('请输入角色名称');
      return;
    }

    setLoading(true);
    try {
      const success = await window.electronAPI.createCharacter(formData);

      if (success) {
        alert('角色添加成功！');
        onSaved();
        onClose();
      } else {
        alert('添加失败，请重试');
      }
    } catch (error) {
      console.error('添加角色失败:', error);
      alert('添加失败：' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalWrapper onClose={onClose} title="添加新角色">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className={labelClass}>
            角色名称 <span className="text-primary">*</span>
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className={inputClass}
            placeholder="例如：小樱"
            required
          />
        </div>

        <div>
          <label className={labelClass}>
            昵称
          </label>
          <input
            type="text"
            value={formData.nickname}
            onChange={(e) => setFormData({ ...formData, nickname: e.target.value })}
            className={inputClass}
            placeholder="例如：樱"
          />
        </div>

        <div>
          <label className={labelClass}>
            关系标签
          </label>
          <input
            type="text"
            value={formData.relationship_label}
            onChange={(e) => setFormData({ ...formData, relationship_label: e.target.value })}
            className={inputClass}
            placeholder="例如：青梅竹马、学生会长"
          />
        </div>

        <div>
          <label className={labelClass}>
            初始好感度
          </label>
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
              <input
                type="range"
                min="0"
                max="100"
                value={formData.affinity}
                onChange={(e) => setFormData({ ...formData, affinity: parseInt(e.target.value) })}
                className="w-full h-2 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-r [&::-webkit-slider-thumb]:from-primary [&::-webkit-slider-thumb]:to-pink-400 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-primary/40 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110"
                style={{
                  background: `linear-gradient(to right, #c51662 0%, #c51662 ${formData.affinity}%, rgba(255,255,255,0.1) ${formData.affinity}%, rgba(255,255,255,0.1) 100%)`
                }}
              />
            </div>
            <span className={`${accentTextClass} min-w-[48px] text-right px-3 py-1.5 rounded-lg bg-primary/20 border border-primary/30`}>
              {formData.affinity}%
            </span>
          </div>
        </div>

        <div>
          <label className={labelClass}>
            备注
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className={`${inputClass} resize-none`}
            rows="3"
            placeholder="可选：添加一些关于这个角色的备注..."
          />
        </div>

        <div className="flex gap-4 pt-6 border-t border-white/10">
          <button
            type="submit"
            disabled={loading}
            className="px-8 py-3 bg-gradient-to-r from-primary to-pink-500 text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-primary/30 hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {loading ? '添加中...' : '添加角色'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-8 py-3 bg-white/5 border border-white/10 text-white/70 rounded-xl font-medium hover:bg-white/10 hover:text-white hover:border-white/20 transition-all duration-200"
          >
            取消
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

export function CharacterDetailModal({ characterId, details, onClose, onSaved }) {
  const [formData, setFormData] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [newTag, setNewTag] = useState('');

  useEffect(() => {
    if (details) {
      setFormData(JSON.parse(JSON.stringify(details)));
    }
    setEditMode(false);
  }, [details]);

  if (!details) {
    return (
      <ModalWrapper onClose={onClose} title="加载中">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-2 border-primary/30 border-t-primary"></div>
          <p className="mt-4 text-pink-200/60">加载中...</p>
        </div>
      </ModalWrapper>
    );
  }

  const toggleEditMode = () => {
    if (!editMode) {
      setFormData(JSON.parse(JSON.stringify(details)));
    }
    setEditMode(!editMode);
  };

  const updateTopLevelField = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const updateProfileField = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      profile: {
        ...(prev?.profile || {}),
        [field]: value,
      },
    }));
  };

  const addTag = () => {
    if (!newTag.trim()) return;
    setFormData((prev) => {
      const tags = prev?.profile?.tags ? [...prev.profile.tags] : [];
      if (tags.includes(newTag.trim())) return prev;
      return {
        ...prev,
        profile: {
          ...(prev?.profile || {}),
          tags: [...tags, newTag.trim()],
        },
      };
    });
    setNewTag('');
  };

  const removeTag = (tag) => {
    setFormData((prev) => {
      const tags = (prev?.profile?.tags || []).filter((t) => t !== tag);
      return {
        ...prev,
        profile: {
          ...(prev?.profile || {}),
          tags,
        },
      };
    });
  };

  const saveEditedDetails = async () => {
    if (!characterId || !formData) return;
    try {
      const api = window.electronAPI;
      if (!api?.saveCharacterDetails) {
        alert('保存失败：桌面端尚未加载 saveCharacterDetails API，请重启应用后重试（开发模式：停止并重新运行 pnpm dev）。');
        return;
      }
      const success = await api.saveCharacterDetails(characterId, formData);
      if (success) {
        alert('保存成功！');
        setEditMode(false);
        if (onSaved) onSaved();
      } else {
        alert('保存失败，请重试');
      }
    } catch (error) {
      console.error('Failed to save edited details:', error);
      alert('保存失败：' + error.message);
    }
  };

  const personalityTags = details.personality_traits?.keywords || [];
  const likes = details.likes_dislikes?.likes || [];
  const dislikes = details.likes_dislikes?.dislikes || [];
  const events = details.important_events || [];

  return (
    <ModalWrapper onClose={onClose} title={`查看 ${details.profile?.name ?? ''} 的详细信息`}>
      <div className="space-y-6">
        <Section title="角色档案" icon="person">
          <ProfileSection editMode={editMode} data={formData?.profile} onChange={updateProfileField} />
          <TagsSection tags={formData?.profile?.tags || []} editMode={editMode} newTag={newTag} setNewTag={setNewTag} addTag={addTag} removeTag={removeTag} />
        </Section>

        <Section title="性格特点" icon="psychology">
          <div className="flex flex-wrap gap-2 mb-3">
            {personalityTags.map((tag) => (
              <span key={tag} className="px-3 py-1.5 bg-primary/20 text-primary text-xs rounded-lg border border-primary/20">
                {tag}
              </span>
            ))}
          </div>
          <p className="text-sm text-pink-100/70">
            {details.personality_traits?.descriptions?.join('；') || '暂无性格描述'}
          </p>
        </Section>

        <Section title="喜好厌恶" icon="favorite">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ListBlock label="喜欢" items={likes} emptyLabel="暂无数据" />
            <ListBlock label="不喜欢" items={dislikes} emptyLabel="暂无数据" />
          </div>
        </Section>

        <Section title="重要事件" icon="event">
          {events.length === 0 && <p className="text-sm text-pink-200/50 italic">暂无数据</p>}
          <div className="space-y-4">
            {events.map((event, idx) => (
              <div key={idx} className="border-l-2 border-primary/60 pl-4 pb-3 hover:border-primary transition-colors">
                <div className="flex items-start justify-between mb-1">
                  <div className="font-medium text-white">{event.title}</div>
                  <div className="text-xs text-pink-200/50 bg-white/5 px-2 py-0.5 rounded">
                    {event.date ? new Date(event.date).toLocaleDateString('zh-CN') : ''}
                  </div>
                </div>
                {event.summary && <p className="text-sm text-pink-100/70 mb-1">{event.summary}</p>}
                {event.affinity_change !== undefined && (
                  <div className="text-xs text-emerald-400 font-medium">
                    好感度{event.affinity_change > 0 ? '+' : ''}
                    {event.affinity_change}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section title="对话总结" icon="chat_bubble">
          {editMode ? (
            <textarea
              value={formData?.conversation_summary || ''}
              onChange={(e) => updateTopLevelField('conversation_summary', e.target.value)}
              className="w-full px-4 py-3 text-sm rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all resize-none"
              rows={4}
            />
          ) : (
            <p className="text-sm text-pink-100/70 leading-relaxed">
              {details.conversation_summary || '暂无对话总结'}
            </p>
          )}
        </Section>
      </div>

      <div className="mt-8 flex justify-between gap-4 pt-6 border-t border-white/10">
        <button
          onClick={toggleEditMode}
          className="px-5 py-2.5 text-sm rounded-xl bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white hover:border-white/20 transition-all duration-200"
        >
          {editMode ? '取消编辑' : '编辑模式'}
        </button>
        {editMode && (
          <button
            onClick={saveEditedDetails}
            className="px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-emerald-500/30 hover:scale-[1.02] transition-all duration-200"
          >
            保存更改
          </button>
        )}
      </div>
    </ModalWrapper>
  );
}

function ModalWrapper({ children, onClose, title }) {
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-black/70 via-black/60 to-primary/20 backdrop-blur-md" 
      onClick={onClose}
    >
      <div
        className="relative bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#1a1a2e] rounded-3xl p-8 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto shadow-[0_25px_60px_-15px_rgba(197,22,98,0.3)] border border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 装饰性光晕效果 */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10">
          <Header title={title} onClose={onClose} />
          {children}
        </div>
      </div>
    </div>
  );
}

function Header({ title, onClose }) {
  return (
    <div className="flex items-center gap-4 mb-8">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/30 to-pink-500/20 flex items-center justify-center border border-primary/20 shadow-lg shadow-primary/10">
        <span className="material-symbols-outlined text-primary text-3xl drop-shadow-glow">account_circle</span>
      </div>
      <div className="flex-1">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-white via-pink-100 to-white bg-clip-text text-transparent">{title}</h2>
        <p className="text-sm text-pink-200/60 mt-1">角色档案与对话总结</p>
      </div>
      <button
        onClick={onClose}
        className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all duration-200 border border-white/10 hover:border-white/20"
      >
        <span className="material-symbols-outlined">close</span>
      </button>
    </div>
  );
}

function Section({ title, icon, children }) {
  return (
    <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-3">
        <span className="material-symbols-outlined text-primary drop-shadow-glow">{icon}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

function ProfileSection({ editMode, data, onChange }) {
  const value = data || {};
  const editInputClass = 'flex-1 px-3 py-2 text-sm rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/30 transition-all';
  return (
    <div className="space-y-3 text-sm">
      {['name', 'nickname', 'relationship_label'].map((field) => (
        <div key={field} className="flex items-center gap-3">
          <span className="text-pink-200/60 w-20">
            {field === 'name' ? '姓名：' : field === 'nickname' ? '昵称：' : '关系：'}
          </span>
          {editMode ? (
            <input
              value={value[field] || ''}
              onChange={(e) => onChange(field, e.target.value)}
              className={editInputClass}
            />
          ) : (
            <span className="text-white font-medium flex-1">
              {value[field] || ''}
            </span>
          )}
        </div>
      ))}
      <div className="flex items-center gap-3">
        <span className="text-pink-200/60 w-20">好感度：</span>
        {editMode ? (
          <input
            type="number"
            min={0}
            max={100}
            value={value.affinity ?? ''}
            onChange={(e) => onChange('affinity', Number(e.target.value))}
            className={`w-24 ${editInputClass}`}
          />
        ) : (
          <span className="text-white font-medium">
            {value.affinity !== undefined ? `${value.affinity}%` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

function TagsSection({ tags, editMode, newTag, setNewTag, addTag, removeTag }) {
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className="px-3 py-1.5 bg-primary/20 text-primary text-xs rounded-lg inline-flex items-center gap-2 border border-primary/20"
          >
            {tag}
            {editMode && (
              <button type="button" onClick={() => removeTag(tag)} className="text-sm hover:text-red-400 transition-colors">
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {editMode && (
        <div className="mt-3 flex gap-2">
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            className="flex-1 px-3 py-2 text-sm rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
            placeholder="添加标签（回车或点击添加）"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
          />
          <button
            type="button"
            onClick={addTag}
            className="px-4 py-2 text-sm bg-gradient-to-r from-primary to-pink-500 text-white rounded-lg hover:shadow-lg hover:shadow-primary/30 transition-all"
          >
            添加
          </button>
        </div>
      )}
    </div>
  );
}

function ListBlock({ label, items, emptyLabel }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold text-white">{label}</span>
        <span className="text-xs text-pink-200/40">•</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-pink-200/50 italic">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item, idx) => (
            <p key={`${item}-${idx}`} className="text-sm text-pink-100/70">
              • {item}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}


