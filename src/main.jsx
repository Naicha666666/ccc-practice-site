import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { supabase, supabaseConfigured } from './supabaseClient.js';
import {
  deleteRemoteProgress,
  fetchRemoteProgress,
  mergeProgress,
  upsertProgressBatch,
  upsertProgressRecord
} from './progressSync.js';
import './styles.css';

const STORAGE_KEY = 'ccc-practice-progress-v1';
const ANSWERS = ['A', 'B', 'C', 'D', 'E'];

function makeId(year, question) {
  return `${year}-${question}`;
}

function normalizeQuestion(question, explanations, videos) {
  const id = makeId(question.year, question.question);
  const explanation = explanations[String(question.year)]?.[String(question.question)] ?? null;
  return {
    ...question,
    id,
    title: `${question.year} Q${String(question.question).padStart(2, '0')}`,
    answer: explanation?.ai_answer ?? null,
    explanation: explanation?.explanation ?? '',
    explanationEn: explanation?.explanation_en ?? '',
    tags: explanation?.tags ?? [],
    isTricky: (explanation?.tags ?? []).includes('易错题'),
    video: videos[id] ?? null
  };
}

async function fetchJson(path, fallback) {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(error);
    return fallback;
  }
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProgress(progress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function useHashlessRoute() {
  const currentRoute = () => `${window.location.pathname}${window.location.search}`;
  const [path, setPath] = useState(currentRoute);

  useEffect(() => {
    const onPopState = () => setPath(currentRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (nextPath) => {
    window.history.pushState({}, '', nextPath);
    setPath(nextPath);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const replace = (nextPath) => {
    window.history.replaceState({}, '', nextPath);
    setPath(nextPath);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return { path, navigate, replace };
}

function App() {
  const { path, navigate, replace } = useHashlessRoute();
  const [questions, setQuestions] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [progress, setProgress] = useState(loadProgress);
  const progressRef = useRef(progress);
  const [user, setUser] = useState(null);
  const [authState, setAuthState] = useState(supabaseConfigured ? 'checking' : 'unconfigured');
  const [authMessage, setAuthMessage] = useState('');
  const [syncState, setSyncState] = useState('local');
  const [syncedUserId, setSyncedUserId] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchJson('/metadata.json', { questions: [] }),
      fetchJson('/explanations.json', {}),
      fetchJson('/videos.json', {})
    ]).then(([metadata, explanations, videos]) => {
      if (!active) return;
      const merged = (metadata.questions ?? [])
        .map((question) => normalizeQuestion(question, explanations, videos))
        .sort((a, b) => a.year - b.year || a.question - b.question);
      setQuestions(merged);
      setLoadState(merged.length ? 'ready' : 'empty');
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    saveProgress(progress);
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    if (!supabaseConfigured) return;

    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setAuthState(data.session?.user ? 'signed-in' : 'signed-out');
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthState(session?.user ? 'signed-in' : 'signed-out');
      setSyncedUserId(null);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabaseConfigured || !user || !questions.length || syncedUserId === user.id) return;

    let active = true;
    setSyncState('syncing');
    fetchRemoteProgress(supabase, user.id)
      .then(async (remoteProgress) => {
        if (!active) return;
        const merged = mergeProgress(progressRef.current, remoteProgress);
        setProgress(merged);
        await upsertProgressBatch(supabase, user.id, questions, merged);
        if (!active) return;
        setSyncState('synced');
        setSyncedUserId(user.id);
      })
      .catch((error) => {
        console.error(error);
        if (!active) return;
        setSyncState('error');
        setAuthMessage(`同步失败：${error.message}`);
      });

    return () => {
      active = false;
    };
  }, [user, questions, syncedUserId]);

  useEffect(() => {
    const pathname = new URL(path, window.location.origin).pathname;
    if (pathname !== '/practice/random' || !questions.length) return;
    const question = pickRandom(questions);
    if (question) {
      replace(`/practice/${question.year}/${question.question}`);
    }
  }, [path, questions]);

  const stats = useMemo(() => buildStats(questions, progress), [questions, progress]);
  const current = useMemo(() => resolveRoute(path, questions, progress), [path, questions, progress]);

  const updateRecord = (id, patch) => {
    const lastVisitedAt = new Date().toISOString();
    const currentRecord = progressRef.current[id] ?? {};
    const nextRecord = {
      ...currentRecord,
      ...patch,
      lastVisitedAt
    };

    setProgress((currentProgress) => ({
      ...currentProgress,
      [id]: {
        ...currentProgress[id],
        ...patch,
        lastVisitedAt
      }
    }));

    const question = questions.find((item) => item.id === id);
    if (supabaseConfigured && user && question) {
      setSyncState('syncing');
      upsertProgressRecord(supabase, user.id, question, nextRecord)
        .then(() => setSyncState('synced'))
        .catch((error) => {
          console.error(error);
          setSyncState('error');
          setAuthMessage(`保存失败：${error.message}`);
        });
    }
  };

  const clearProgress = async () => {
    if (window.confirm('确定要清空本地学习记录吗？这个操作不能撤销。')) {
      setProgress({});
      if (supabaseConfigured && user) {
        try {
          setSyncState('syncing');
          await deleteRemoteProgress(supabase, user.id);
          setSyncState('synced');
        } catch (error) {
          console.error(error);
          setSyncState('error');
          setAuthMessage(`云端清空失败：${error.message}`);
        }
      }
    }
  };

  const handleAuthSubmit = async (mode, email, password) => {
    if (!supabaseConfigured) {
      setAuthMessage('还没有配置 Supabase 环境变量。');
      return;
    }

    setAuthMessage('');
    setAuthState('checking');
    const authCall = mode === 'signup'
      ? supabase.auth.signUp({ email, password })
      : supabase.auth.signInWithPassword({ email, password });
    const { data, error } = await authCall;

    if (error) {
      setAuthState(user ? 'signed-in' : 'signed-out');
      setAuthMessage(error.message);
      return;
    }

    setUser(data.user ?? data.session?.user ?? null);
    setAuthState(data.session?.user ? 'signed-in' : 'signed-out');
    setAuthMessage(mode === 'signup' && !data.session ? '注册成功，请检查邮箱完成验证。' : '已登录，正在同步进度。');
  };

  const handleSignOut = async () => {
    if (!supabaseConfigured) return;
    await supabase.auth.signOut();
    setUser(null);
    setAuthState('signed-out');
    setSyncState('local');
  };

  if (loadState === 'loading') {
    return <Shell navigate={navigate} stats={stats} user={user} authState={authState} syncState={syncState} authMessage={authMessage} onAuthSubmit={handleAuthSubmit} onSignOut={handleSignOut}><div className="empty-state">正在加载题库...</div></Shell>;
  }

  if (loadState === 'empty') {
    return <Shell navigate={navigate} stats={stats} user={user} authState={authState} syncState={syncState} authMessage={authMessage} onAuthSubmit={handleAuthSubmit} onSignOut={handleSignOut}><div className="empty-state">题库数据没有加载成功。</div></Shell>;
  }

  return (
    <Shell
      navigate={navigate}
      stats={stats}
      user={user}
      authState={authState}
      syncState={syncState}
      authMessage={authMessage}
      onAuthSubmit={handleAuthSubmit}
      onSignOut={handleSignOut}
    >
      {current.name === 'dashboard' && (
        <Dashboard questions={questions} progress={progress} stats={stats} navigate={navigate} clearProgress={clearProgress} user={user} syncState={syncState} />
      )}
      {current.name === 'questions' && (
        <QuestionList questions={questions} progress={progress} navigate={navigate} />
      )}
      {current.name === 'practice' && (
        <PracticePage
          question={current.question}
          questions={questions}
          progress={progress}
          navigate={navigate}
          updateRecord={updateRecord}
          user={user}
        />
      )}
      {current.name === 'review' && (
        <ReviewPage title={current.title} questions={current.questions} progress={progress} navigate={navigate} />
      )}
      {current.name === 'missing' && <NotFound navigate={navigate} />}
    </Shell>
  );
}

function resolveRoute(path, questions, progress) {
  const url = new URL(path, window.location.origin);
  const pathname = url.pathname;
  if (pathname === '/') return { name: 'dashboard' };
  if (pathname === '/questions') return { name: 'questions' };
  if (pathname === '/practice/random') {
    return { name: 'dashboard' };
  }
  if (pathname === '/review/wrong') {
    return { name: 'review', title: '错题练习', questions: questions.filter((q) => progress[q.id]?.wrong) };
  }
  if (pathname === '/review/favorites') {
    return { name: 'review', title: '收藏练习', questions: questions.filter((q) => progress[q.id]?.favorite) };
  }
  const match = pathname.match(/^\/practice\/(\d{4})\/(\d{1,2})$/);
  if (match) {
    const question = questions.find((item) => item.year === Number(match[1]) && item.question === Number(match[2]));
    return question ? { name: 'practice', question } : { name: 'missing' };
  }
  return { name: 'missing' };
}

function buildStats(questions, progress) {
  const records = questions.map((q) => progress[q.id]).filter(Boolean);
  const answered = records.filter((record) => record.answeredAt).length;
  const correct = records.filter((record) => record.correct).length;
  return {
    total: questions.length,
    answered,
    accuracy: answered ? Math.round((correct / answered) * 100) : 0,
    wrong: questions.filter((q) => progress[q.id]?.wrong).length,
    favorites: questions.filter((q) => progress[q.id]?.favorite).length,
    tricky: questions.filter((q) => q.isTricky).length
  };
}

function Shell({ children, navigate, stats, user, authState, syncState, authMessage, onAuthSubmit, onSignOut }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('/')}>
          <span className="brand-mark">C</span>
          <span>
            <strong>CCC 刷题</strong>
            <small>Chemistry Contest Practice</small>
          </span>
        </button>
        <nav className="main-nav" aria-label="主导航">
          <button onClick={() => navigate('/')}>首页</button>
          <button onClick={() => navigate('/questions')}>题库</button>
          <button onClick={() => navigate('/review/wrong')}>错题</button>
          <button onClick={() => navigate('/review/favorites')}>收藏</button>
        </nav>
        <AuthPanel
          user={user}
          authState={authState}
          syncState={syncState}
          message={authMessage}
          onSubmit={onAuthSubmit}
          onSignOut={onSignOut}
        />
      </header>
      <section className="stats-strip" aria-label="学习概览">
        <Metric label="总题量" value={stats.total} />
        <Metric label="已完成" value={stats.answered} />
        <Metric label="正确率" value={`${stats.accuracy}%`} />
        <Metric label="错题" value={stats.wrong} />
        <Metric label="收藏" value={stats.favorites} />
      </section>
      <main>{children}</main>
    </div>
  );
}

function AuthPanel({ user, authState, syncState, message, onSubmit, onSignOut }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (event) => {
    event.preventDefault();
    onSubmit(mode, email.trim(), password);
  };

  if (!supabaseConfigured) {
    return (
      <div className="auth-box compact-auth">
        <strong>本地模式</strong>
        <small>配置 Supabase 后开启登录</small>
      </div>
    );
  }

  if (user) {
    return (
      <div className="auth-box signed-in">
        <div>
          <strong>{user.email}</strong>
          <small>{syncState === 'syncing' ? '同步中...' : syncState === 'synced' ? '云端已同步' : syncState === 'error' ? '同步异常' : '本地记录'}</small>
        </div>
        <button type="button" onClick={onSignOut}>退出</button>
      </div>
    );
  }

  return (
    <div className="auth-box">
      <button type="button" onClick={() => setOpen((current) => !current)}>
        {authState === 'checking' ? '检查登录...' : '登录 / 注册'}
      </button>
      {open && (
        <form className="auth-popover" onSubmit={submit}>
          <div className="language-tabs auth-tabs">
            <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>登录</button>
            <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>注册</button>
          </div>
          <label>
            邮箱
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
          </label>
          <label>
            密码
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength="6" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
          </label>
          <button type="submit" className="primary">{mode === 'signin' ? '登录' : '注册'}</button>
          {message && <p className="auth-message">{message}</p>}
        </form>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Dashboard({ questions, progress, stats, navigate, clearProgress, user, syncState }) {
  const years = [...new Set(questions.map((question) => question.year))];
  const lastRecord = Object.entries(progress)
    .filter(([, record]) => record.lastVisitedAt)
    .sort((a, b) => String(b[1].lastVisitedAt).localeCompare(String(a[1].lastVisitedAt)))[0];
  const lastQuestion = lastRecord ? questions.find((q) => q.id === lastRecord[0]) : null;

  return (
    <div className="dashboard">
      <section className="command-band">
        <div>
          <h1>CCC Chemistry 刷题台</h1>
          <p>
            按年份练习、随机抽题、复盘错题，答案和中英讲解都已经接入。
            {user ? ` 当前账号：${user.email}，${syncState === 'synced' ? '云端记录已同步。' : '记录会自动同步到云端。'}` : ' 未登录时会先保存到本机。'}
          </p>
        </div>
        <div className="command-actions">
          <button className="primary" onClick={() => navigate(lastQuestion ? `/practice/${lastQuestion.year}/${lastQuestion.question}` : '/practice/2014/1')}>
            继续练习
          </button>
          <button onClick={() => navigate('/practice/random')}>随机一题</button>
          <button onClick={() => navigate('/questions?tricky=1')}>易错题</button>
        </div>
      </section>

      <section className="year-grid" aria-label="年份入口">
        {years.map((year) => {
          const yearQuestions = questions.filter((q) => q.year === year);
          const done = yearQuestions.filter((q) => progress[q.id]?.answeredAt).length;
          return (
            <button key={year} className="year-tile" onClick={() => navigate(`/questions?year=${year}`)}>
              <span>{year}</span>
              <strong>{done}/{yearQuestions.length}</strong>
            </button>
          );
        })}
      </section>

      <section className="review-band">
        <ReviewShortcut title="错题练习" value={stats.wrong} onClick={() => navigate('/review/wrong')} />
        <ReviewShortcut title="收藏练习" value={stats.favorites} onClick={() => navigate('/review/favorites')} />
        <ReviewShortcut title="易错题" value={stats.tricky} onClick={() => navigate('/questions?tricky=1')} />
        <button className="danger-text" onClick={clearProgress}>清空本地记录</button>
      </section>
    </div>
  );
}

function ReviewShortcut({ title, value, onClick }) {
  return (
    <button className="review-shortcut" onClick={onClick}>
      <span>{title}</span>
      <strong>{value}</strong>
    </button>
  );
}

function QuestionList({ questions, progress, navigate }) {
  const search = new URLSearchParams(window.location.search);
  const [year, setYear] = useState(search.get('year') ?? 'all');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(search.get('tricky') ? 'tricky' : 'all');

  const years = [...new Set(questions.map((question) => question.year))];
  const filtered = questions.filter((question) => {
    const record = progress[question.id] ?? {};
    if (year !== 'all' && question.year !== Number(year)) return false;
    if (query && !String(question.question).includes(query.trim())) return false;
    if (status === 'tricky' && !question.isTricky) return false;
    if (status === 'done' && !record.answeredAt) return false;
    if (status === 'wrong' && !record.wrong) return false;
    if (status === 'favorite' && !record.favorite) return false;
    return true;
  });

  return (
    <section className="question-list-page">
      <div className="section-head">
        <div>
          <h1>题库</h1>
          <p>{filtered.length} 道题符合当前筛选</p>
        </div>
        <button onClick={() => navigate('/practice/random')}>随机一题</button>
      </div>

      <div className="filters">
        <label>
          年份
          <select value={year} onChange={(event) => setYear(event.target.value)}>
            <option value="all">全部年份</option>
            {years.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          题号
          <input inputMode="numeric" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如 12" />
        </label>
        <label>
          状态
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">全部</option>
            <option value="tricky">易错题</option>
            <option value="done">已做</option>
            <option value="wrong">错题</option>
            <option value="favorite">收藏</option>
          </select>
        </label>
      </div>

      <div className="question-grid">
        {filtered.map((question) => {
          const record = progress[question.id] ?? {};
          return (
            <button key={question.id} className="question-card" onClick={() => navigate(`/practice/${question.year}/${question.question}`)}>
              <span className="question-title">{question.title}</span>
              <span className="badges">
                {question.isTricky && <Badge>易错</Badge>}
                {record.answeredAt && <Badge tone={record.correct ? 'good' : 'bad'}>{record.correct ? '已对' : '已错'}</Badge>}
                {record.favorite && <Badge>收藏</Badge>}
              </span>
              <span className="answer-state">{record.revealed ? `已看答案 ${question.answer ?? ''}` : '未看答案'}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PracticePage({ question, questions, progress, navigate, updateRecord, user }) {
  const record = progress[question.id] ?? {};
  const [choice, setChoice] = useState(record.lastAnswer ?? '');
  const [showAnswer, setShowAnswer] = useState(Boolean(record.revealed));
  const [language, setLanguage] = useState('zh');
  const [zoomed, setZoomed] = useState(false);
  const answerIsVisible = showAnswer || Boolean(record.revealed);

  useEffect(() => {
    setChoice(record.lastAnswer ?? '');
    setShowAnswer(Boolean(record.revealed));
    updateRecord(question.id, {});
  }, [question.id]);

  const index = questions.findIndex((item) => item.id === question.id);
  const previous = questions[index - 1];
  const next = questions[index + 1];

  const submit = (answer) => {
    const correct = question.answer ? answer === question.answer : false;
    setChoice(answer);
    setShowAnswer(true);
    updateRecord(question.id, {
      lastAnswer: answer,
      correct,
      wrong: question.answer ? !correct : record.wrong,
      revealed: true,
      answeredAt: new Date().toISOString()
    });
  };

  const toggleFavorite = () => updateRecord(question.id, { favorite: !record.favorite });
  const toggleWrong = () => updateRecord(question.id, { wrong: !record.wrong });
  const revealAnswer = () => {
    setShowAnswer(true);
    updateRecord(question.id, { revealed: true });
  };

  return (
    <section className="practice-page">
      <div className="practice-toolbar">
        <div>
          <h1>{question.title}</h1>
          <p>Page {question.page} · {question.tags.length ? question.tags.join(' / ') : '普通题'}</p>
        </div>
        <div className="toolbar-actions">
          <button type="button" onClick={toggleFavorite}>{record.favorite ? '已收藏' : '收藏'}</button>
          <button type="button" onClick={toggleWrong}>{record.wrong ? '移出错题' : '标记错题'}</button>
          <button type="button" onClick={() => setZoomed(true)}>放大题图</button>
        </div>
      </div>

      <div className="practice-layout">
        <div className="question-image-panel">
          <img src={`/${question.file}`} alt={question.title} loading="lazy" />
        </div>

        <aside className="answer-panel">
          <div className="choice-grid" aria-label="选项">
            {ANSWERS.map((answer) => (
              <button
                type="button"
                key={answer}
                className={choice === answer ? 'selected' : ''}
                onClick={() => submit(answer)}
              >
                {answer}
              </button>
            ))}
          </div>

          {answerIsVisible ? (
            <div className="explanation">
              <div className="result-line">
                <strong>正确答案：{question.answer ?? '缺失'}</strong>
                {choice && question.answer && <span className={choice === question.answer ? 'good-text' : 'bad-text'}>{choice === question.answer ? '回答正确' : `你的答案：${choice}`}</span>}
              </div>
              <div className="language-tabs">
                <button type="button" className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')}>中文</button>
                <button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>English</button>
              </div>
              <p>{language === 'zh' ? question.explanation || '这道题暂时没有中文讲解。' : question.explanationEn || 'No English explanation yet.'}</p>
            </div>
          ) : (
            <button type="button" className="primary reveal-button" onClick={revealAnswer}>
              查看答案讲解
            </button>
          )}

          <div className="video-box">
            {!user ? (
              <span>登录后观看视频讲解</span>
            ) : question.video?.url ? (
              <a href={question.video.url} target="_blank" rel="noreferrer">{question.video.title || '打开视频讲解'}</a>
            ) : (
              <span>视频讲解暂未添加</span>
            )}
          </div>
        </aside>
      </div>

      <div className="pager">
        <button type="button" disabled={!previous} onClick={() => previous && navigate(`/practice/${previous.year}/${previous.question}`)}>上一题</button>
        <button type="button" onClick={() => navigate('/questions')}>返回题库</button>
        <button type="button" disabled={!next} onClick={() => next && navigate(`/practice/${next.year}/${next.question}`)}>下一题</button>
      </div>

      {zoomed && (
        <div className="modal-backdrop" onClick={() => setZoomed(false)}>
          <div className="image-modal" role="dialog" aria-modal="true">
            <button type="button" className="modal-close" onClick={() => setZoomed(false)}>关闭</button>
            <img src={`/${question.file}`} alt={`${question.title} 放大图`} />
          </div>
        </div>
      )}
    </section>
  );
}

function ReviewPage({ title, questions, progress, navigate }) {
  return (
    <section className="question-list-page">
      <div className="section-head">
        <div>
          <h1>{title}</h1>
          <p>{questions.length ? `${questions.length} 道题待复习` : '这里还没有题目'}</p>
        </div>
        <button onClick={() => navigate('/questions')}>回到题库</button>
      </div>
      {questions.length ? (
        <div className="question-grid">
          {questions.map((question) => (
            <button key={question.id} className="question-card" onClick={() => navigate(`/practice/${question.year}/${question.question}`)}>
              <span className="question-title">{question.title}</span>
              <span className="badges">
                {progress[question.id]?.wrong && <Badge tone="bad">错题</Badge>}
                {progress[question.id]?.favorite && <Badge>收藏</Badge>}
              </span>
              <span className="answer-state">答案 {question.answer ?? '缺失'}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state">完成几道题后，这里会自动出现内容。</div>
      )}
    </section>
  );
}

function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function NotFound({ navigate }) {
  return (
    <div className="empty-state">
      <h1>页面不存在</h1>
      <button className="primary" onClick={() => navigate('/')}>回首页</button>
    </div>
  );
}

function pickRandom(questions) {
  return questions[Math.floor(Math.random() * questions.length)] ?? null;
}

createRoot(document.getElementById('root')).render(<App />);
