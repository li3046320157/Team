import { useEffect, useRef, useState } from 'react';
import { Bot, KeyRound, Link2, RefreshCw, Send, Settings2, Square, Trash2, User } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { Badge, Button, Card, Field, InfoNote, PageHeader, cn } from '../components/ui';
import {
  ANALYSIS_SYSTEM_PROMPT,
  AiError,
  buildAnalysisContext,
  fetchModelList,
  loadAiConfig,
  maskKey,
  saveAiConfig,
  streamChat,
  validateAiConfig,
  type AiConfig,
  type ChatMessage,
} from '../services/ai';

const QUICK_PROMPTS = [
  '分析我的消费结构，指出最值得优化的一项',
  '未来 90 天有什么现金流风险？如何避免？',
  '怎样安排才能更快达成储蓄目标？',
  '本月哪些支出可以省下来？给具体建议',
];

interface UiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function AssistantPage() {
  const user = useAppStore((s) => s.user);
  const dataset = useAppStore((s) => s.dataset);
  const mode = useAppStore((s) => s.mode);
  const notify = useAppStore((s) => s.notify);

  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [configOpen, setConfigOpen] = useState(true);
  const [savedConfig, setSavedConfig] = useState<AiConfig | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!user) return;
    const config = loadAiConfig(user.id);
    if (config) {
      setBaseUrl(config.baseUrl);
      setApiKey(config.apiKey);
      setModel(config.model);
      setSavedConfig(config);
      setConfigOpen(false);
    }
  }, [user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const saveConfig = () => {
    if (!user) return;
    const config: AiConfig = { baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() };
    const invalid = validateAiConfig(config);
    if (invalid) {
      setConfigError(invalid);
      return;
    }
    try {
      saveAiConfig(user.id, config);
      setSavedConfig(config);
      setConfigError(null);
      setConfigOpen(false);
      notify('AI 接口配置已保存到本机', 'success');
    } catch {
      setConfigError('保存失败：浏览器存储不可用');
    }
  };

  const loadModels = async () => {
    const config: AiConfig = { baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() };
    if (!config.baseUrl || !config.apiKey) {
      setConfigError('请先填写 API 地址与密钥，再拉取模型列表');
      return;
    }
    setFetchingModels(true);
    setConfigError(null);
    try {
      const ids = await fetchModelList(config);
      setModelOptions(ids);
      if (!model.trim() && ids.length > 0) setModel(ids[0]);
      notify(`已获取 ${ids.length} 个可用模型`, 'success');
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : '拉取模型列表失败');
    } finally {
      setFetchingModels(false);
    }
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || streaming || !dataset) return;
    const config = savedConfig ?? { baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() };
    const invalid = validateAiConfig(config);
    if (invalid) {
      setConfigOpen(true);
      setConfigError(invalid);
      return;
    }
    setChatError(null);
    setInput('');
    const history: ChatMessage[] = [
      { role: 'system', content: `${ANALYSIS_SYSTEM_PROMPT}\n\n当前账本摘要：\n${buildAnalysisContext(dataset, mode)}` },
      ...messages.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
      { role: 'user', content: question },
    ];
    setMessages((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '' }]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat({
        config,
        messages: history,
        signal: controller.signal,
        onDelta: (delta) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + delta };
            return next;
          });
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'assistant' && !last.content) next.pop();
          return next;
        });
      } else {
        const message = error instanceof AiError || error instanceof Error ? error.message : '请求失败，请重试';
        setChatError(message);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'assistant' && !last.content) next.pop();
          return next;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="fade-in" data-testid="assistant">
      <PageHeader
        title="AI 智能分析"
        description="用你自己的 AI 接口解读账本：消费结构、现金流风险、储蓄节奏。对话与密钥只留在本机，请求直接发往你填写的 API 地址。"
        actions={<Badge tone="teal"><Bot size={11} /> 自带 API</Badge>}
      />

      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <Card
          title="接口配置"
          subtitle={savedConfig ? `已配置 · ${maskKey(savedConfig.apiKey)}` : '支持官方或中转 API（OpenAI 兼容格式）'}
          action={
            <Button size="xs" variant="ghost" onClick={() => setConfigOpen((v) => !v)} aria-label="展开或收起配置">
              <Settings2 size={13} /> {configOpen ? '收起' : '修改'}
            </Button>
          }
        >
          {configOpen ? (
            <div className="space-y-3.5">
              <Field label="API 访问地址" hint="填到 /v1 这一级即可，例如 https://api.openai.com/v1 或中转地址">
                <div className="relative">
                  <Link2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A097]" />
                  <input className="input !pl-8" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" data-testid="ai-base" />
                </div>
              </Field>
              <Field label="API 密钥" hint="仅保存在本机浏览器，不会写入代码或上传本站">
                <div className="relative">
                  <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A097]" />
                  <input
                    className="input !pl-8 !pr-16"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-…"
                    data-testid="ai-key"
                  />
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[11px] font-semibold text-[#0B6357]" onClick={() => setShowKey((v) => !v)}>
                    {showKey ? '隐藏' : '显示'}
                  </button>
                </div>
              </Field>
              <Field label="模型名称" hint="可手动填写，或从该接口拉取可用模型">
                <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="如 gpt-4o-mini / deepseek-chat" list="ai-model-options" data-testid="ai-model" />
                <datalist id="ai-model-options">
                  {modelOptions.map((id) => <option key={id} value={id} />)}
                </datalist>
              </Field>
              {configError && <p className="rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] text-[#98362E]" role="alert">{configError}</p>}
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" onClick={saveConfig} data-testid="ai-save">保存配置</Button>
                <Button variant="secondary" onClick={() => void loadModels()} disabled={fetchingModels} data-testid="ai-fetch-models">
                  <RefreshCw size={13} className={fetchingModels ? 'animate-spin' : undefined} /> 拉取模型
                </Button>
              </div>
              <InfoNote tone="warn">
                密钥与对话只存本机；分析请求由浏览器直接发往你填写的地址，请确认该服务可信。部分接口不允许浏览器跨域访问，如遇连接失败可更换支持 CORS 的中转地址。
              </InfoNote>
            </div>
          ) : (
            <div className="space-y-2 text-[12px] leading-relaxed text-[#6B6A63]">
              <p className="truncate">地址：{savedConfig?.baseUrl}</p>
              <p>模型：{savedConfig?.model}</p>
              <p>密钥：{savedConfig ? maskKey(savedConfig.apiKey) : ''}</p>
            </div>
          )}
        </Card>

        <Card title="分析对话" subtitle={mode === 'demo' ? '当前分析的是合成示例数据' : '基于你本机账本的实时摘要'} className="flex flex-col">
          <div ref={scrollRef} className="scroll-thin mb-3 h-[420px] space-y-3 overflow-y-auto rounded-xl border border-[#EFECE6] bg-[#FCFBF7] p-4">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#E3F1ED] text-[#0B6357]"><Bot size={22} /></div>
                <p className="text-[13px] font-semibold text-[#3A3D37]">让 AI 帮你读账本</p>
                <p className="max-w-sm text-[12px] leading-relaxed text-[#8A887F]">
                  先配置左侧接口，然后点击下方问题或直接提问。每次提问都会附上当前余额、本月收支、90 天预测与目标进摘要。
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn('flex gap-2.5', m.role === 'user' && 'flex-row-reverse')}>
                <div className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg', m.role === 'user' ? 'bg-[#EFECE6] text-[#6B6A63]' : 'bg-[#E3F1ED] text-[#0B6357]')}>
                  {m.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                </div>
                <div
                  className={cn(
                    'max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-[12.5px] leading-relaxed',
                    m.role === 'user' ? 'bg-[#0E7568] text-white' : 'border border-[#E4E0D8] bg-white text-[#1F2421]',
                  )}
                  data-testid={m.role === 'assistant' ? 'assistant-msg' : 'user-msg'}
                >
                  {m.content}
                  {streaming && i === messages.length - 1 && m.role === 'assistant' && <span className="typing-caret" aria-hidden="true" />}
                </div>
              </div>
            ))}
          </div>

          {chatError && <p className="mb-3 rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] text-[#98362E]" role="alert" data-testid="chat-error">{chatError}</p>}

          <div className="mb-3 flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q}
                type="button"
                className="rounded-full border border-[#E4E0D8] bg-white px-3 py-1.5 text-[11.5px] font-medium text-[#0B6357] transition hover:border-[#0E7568] hover:bg-[#E3F1ED] disabled:opacity-50"
                onClick={() => void send(q)}
                disabled={streaming || !savedConfig}
              >
                {q}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-2">
            <textarea
              className="textarea min-h-[44px] flex-1 resize-none"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder={savedConfig ? '问问你的账本，例如：我每月最多能存多少钱？' : '请先在左侧配置 API 接口'}
              disabled={streaming}
              data-testid="chat-input"
            />
            {streaming ? (
              <Button variant="danger" onClick={() => abortRef.current?.abort()} aria-label="停止生成" data-testid="chat-stop">
                <Square size={14} /> 停止
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void send(input)} disabled={!input.trim()} aria-label="发送" data-testid="chat-send">
                <Send size={14} /> 发送
              </Button>
            )}
            <Button variant="ghost" onClick={() => { setMessages([]); setChatError(null); }} disabled={streaming || messages.length === 0} aria-label="清空对话" data-testid="chat-clear">
              <Trash2 size={14} />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}