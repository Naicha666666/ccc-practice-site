export function rowToRecord(row) {
  return {
    lastAnswer: row.last_answer ?? '',
    correct: Boolean(row.correct),
    wrong: Boolean(row.wrong),
    favorite: Boolean(row.favorite),
    revealed: Boolean(row.revealed),
    answeredAt: row.answered_at ?? null,
    lastVisitedAt: row.last_visited_at ?? row.updated_at ?? null,
    syncedAt: row.updated_at ?? null
  };
}

export function recordToRow(userId, question, record) {
  return {
    user_id: userId,
    question_id: question.id,
    year: question.year,
    question_number: question.question,
    last_answer: record.lastAnswer || null,
    correct: record.correct ?? null,
    wrong: Boolean(record.wrong),
    favorite: Boolean(record.favorite),
    revealed: Boolean(record.revealed),
    answered_at: record.answeredAt ?? null,
    last_visited_at: record.lastVisitedAt ?? null,
    updated_at: new Date().toISOString()
  };
}

export function rowsToProgress(rows) {
  return Object.fromEntries(rows.map((row) => [row.question_id, rowToRecord(row)]));
}

export function mergeProgress(localProgress, remoteProgress) {
  const merged = { ...localProgress };

  for (const [id, remoteRecord] of Object.entries(remoteProgress)) {
    const localRecord = merged[id];
    if (!localRecord) {
      merged[id] = remoteRecord;
      continue;
    }

    const localTime = Date.parse(localRecord.lastVisitedAt ?? localRecord.syncedAt ?? 0);
    const remoteTime = Date.parse(remoteRecord.lastVisitedAt ?? remoteRecord.syncedAt ?? 0);
    merged[id] = remoteTime > localTime ? { ...localRecord, ...remoteRecord } : { ...remoteRecord, ...localRecord };
  }

  return merged;
}

export async function fetchRemoteProgress(supabase, userId) {
  const { data, error } = await supabase
    .from('user_question_progress')
    .select('*')
    .eq('user_id', userId);

  if (error) throw error;
  return rowsToProgress(data ?? []);
}

export async function upsertProgressRecord(supabase, userId, question, record) {
  const { error } = await supabase
    .from('user_question_progress')
    .upsert(recordToRow(userId, question, record), { onConflict: 'user_id,question_id' });

  if (error) throw error;
}

export async function upsertProgressBatch(supabase, userId, questions, progress) {
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const rows = Object.entries(progress)
    .map(([id, record]) => {
      const question = questionById.get(id);
      return question ? recordToRow(userId, question, record) : null;
    })
    .filter(Boolean);

  if (!rows.length) return;

  const { error } = await supabase
    .from('user_question_progress')
    .upsert(rows, { onConflict: 'user_id,question_id' });

  if (error) throw error;
}

export async function deleteRemoteProgress(supabase, userId) {
  const { error } = await supabase
    .from('user_question_progress')
    .delete()
    .eq('user_id', userId);

  if (error) throw error;
}
