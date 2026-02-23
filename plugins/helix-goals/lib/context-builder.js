export function buildGoalContext(goal, opts = {}) {
  if (!goal) return null;
  const { currentSessionKey } = opts;

  const lines = [
    `<goal id="${goal.id}" status="${goal.status || 'active'}">`,
    `# ${goal.title}`,
  ];

  // Compact meta line: P0 · Deadline: 2026-02-15
  const meta = [];
  if (goal.priority) meta.push(goal.priority);
  if (goal.deadline) meta.push(`Deadline: ${goal.deadline}`);
  if (meta.length) lines.push(meta.join(' · '));

  if (goal.worktree?.path) {
    lines.push(`Workspace: ${goal.worktree.path} (branch: ${goal.worktree.branch})`);
  }

  if (goal.description) lines.push('', goal.description);

  if (goal.tasks?.length) {
    const doneCount = goal.tasks.filter(t => t.done || t.status === 'done').length;
    lines.push('', `Tasks (${doneCount}/${goal.tasks.length} done):`);
    for (const t of goal.tasks) {
      const status = t.status || (t.done ? 'done' : 'pending');
      const isDone = t.done || status === 'done';
      let suffix = '';
      if (currentSessionKey && t.sessionKey === currentSessionKey) {
        suffix = ' ← you';
      } else if (t.sessionKey) {
        suffix = ` (agent: ${t.sessionKey})`;
      } else if (!isDone) {
        suffix = ' — unassigned';
      }
      lines.push(`- [${status}] ${t.text} [${t.id}]${suffix}`);
      if (isDone && t.summary) {
        lines.push(`  > ${t.summary}`);
      }
    }
  }

  lines.push('</goal>');

  return lines.join('\n');
}

export function buildProjectSummary(strand, goals, currentGoalId) {
  if (!strand || !Array.isArray(goals) || goals.length === 0) return null;

  const cap = 15;
  const shown = goals.slice(0, cap);
  const remaining = goals.length - cap;

  const lines = [
    `<project name="${strand.name}" id="${strand.id}" goals="${goals.length}">`,
  ];

  for (let i = 0; i < shown.length; i++) {
    const g = shown[i];
    const status = g.status || 'active';
    let suffix = '';
    if (g.id === currentGoalId) {
      suffix = ' ← this goal';
    } else if (status === 'active' && g.tasks?.length) {
      const done = g.tasks.filter(t => t.done || t.status === 'done').length;
      suffix = ` — ${done}/${g.tasks.length} tasks`;
    }
    lines.push(`${i + 1}. [${status}] ${g.title} (${g.id})${suffix}`);
  }

  if (remaining > 0) {
    lines.push(`... and ${remaining} more`);
  }

  lines.push('</project>');

  return lines.join('\n');
}

export function getProjectSummaryForGoal(goal, data) {
  if (!goal?.strandId) return null;
  const strand = data.strands.find(c => c.id === goal.strandId);
  if (!strand) return null;
  const siblingGoals = data.goals.filter(g => g.strandId === goal.strandId);
  return buildProjectSummary(strand, siblingGoals, goal.id);
}

export function buildStrandMenuContext(strands, goals) {
  if (!strands?.length) return null;

  const lines = [
    '## Session Not Yet Assigned to a Project',
    '',
    'Based on the user\'s message, determine the most relevant project and use the `strand_bind` tool to assign this session.',
    '',
    '### Available Projects',
  ];

  for (const strand of strands) {
    const strandGoals = goals.filter(g => g.strandId === strand.id && g.status === 'active');
    lines.push(`- **${strand.name}** (${strand.id})`);
    if (strand.description) lines.push(`  ${strand.description}`);
    if (strandGoals.length > 0) {
      const goalNames = strandGoals.slice(0, 3).map(g => g.title);
      lines.push(`  Active goals: ${goalNames.join(', ')}${strandGoals.length > 3 ? ` (+${strandGoals.length - 3} more)` : ''}`);
    }
  }

  lines.push('', 'If none of these projects match, proceed without binding.');

  return lines.join('\n');
}

export function buildStrandContext(strand, goals, opts = {}) {
  if (!strand) return null;
  const { currentSessionKey } = opts;

  const lines = [
    `[SESSION SCOPE: strand ${strand.id}] This session is exclusively for strand "${strand.name}". Do not reference or mix context from other strands or projects.`,
    '',
    `# Strand: ${strand.name}`,
  ];

  if (strand.workspace?.path) {
    lines.push(`Workspace: ${strand.workspace.path}`);
  }

  if (strand.description) lines.push('', strand.description);

  if (goals.length) {
    lines.push('', '## Goals');
    for (const goal of goals) {
      const goalBlock = buildGoalContext(goal, { currentSessionKey });
      if (goalBlock) {
        // Demote Markdown heading inside <goal> block (# → ###) to nest under strand's ## Goals heading
        lines.push('', goalBlock.replace(/^(# )(?!#)/m, '### '));
      }
    }
  }

  // Summary line
  const active = goals.filter(g => g.status !== 'done');
  const completed = goals.filter(g => g.status === 'done');
  const pendingTasks = goals.reduce((n, g) => n + (g.tasks || []).filter(t => !t.done && t.status !== 'done').length, 0);
  lines.push('', '---');
  lines.push(`Active: ${active.length} goals, ${pendingTasks} pending tasks | Completed: ${completed.length} goals`);

  // Tool usage instructions
  lines.push('');
  lines.push('> Use `strand_pm_chat` to send work requests to the PM — describe what you want built and the PM will create a plan with goals and tasks. Use `strand_pm_kickoff` to approve a plan and spawn workers. Use `strand_status` to check progress. Use `goal_update` only to report on tasks assigned to you (marked `← you` above).');

  return lines.join('\n');
}
