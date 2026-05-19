import { displayId, resolveIdOrAlias } from "../lib/alias.ts";
import {
  listPendingQuestions,
  type PendingQuestion,
  rejectQuestion,
  replyQuestion,
} from "../lib/opencode.ts";
import { readDaemonState } from "../lib/state.ts";

export async function runAnswer(
  input: string,
  args: Array<string>,
  options: { reject?: boolean } = {},
): Promise<number> {
  const meta = await resolveIdOrAlias(input);
  if (!meta) {
    console.error(`unknown session: ${input}`);
    return 1;
  }

  const daemon = await readDaemonState();
  if (!daemon) {
    console.error("no daemon running; no pending questions to answer");
    return 1;
  }

  const request = (await listPendingQuestions(daemon.url)).find(
    (question) => question.sessionID === meta.id,
  );
  if (!request) {
    console.error(`no pending question for session ${displayId(meta)}`);
    return 1;
  }

  if (options.reject) {
    if (args.length > 0) {
      console.error("--reject conflicts with answer options");
      return 2;
    }
    await rejectQuestion(daemon.url, request.id);
    console.log(
      `rejected question ${request.id} for session ${displayId(meta)}`,
    );
    return 0;
  }

  let answers: Array<Array<string>>;
  try {
    answers = resolveAnswers(request, args);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }

  await replyQuestion(daemon.url, request.id, answers);
  console.log(`answered question ${request.id} for session ${displayId(meta)}`);
  return 0;
}

function resolveAnswers(
  request: PendingQuestion,
  args: Array<string>,
): Array<Array<string>> {
  if (args.length === 0) {
    throw new Error(
      "answer requires at least one option label or custom answer",
    );
  }

  if (request.questions.length === 1) {
    const question = request.questions[0];
    if (!question) throw new Error(`question ${request.id} has no prompts`);
    return [resolveQuestionAnswers(question, args)];
  }

  if (args.length !== request.questions.length) {
    throw new Error(
      `question ${request.id} has ${request.questions.length} prompts; provide one answer argument per prompt`,
    );
  }

  return request.questions.map((question, index) =>
    resolveQuestionAnswers(question, [args[index] ?? ""]),
  );
}

function resolveQuestionAnswers(
  question: PendingQuestion["questions"][number],
  args: Array<string>,
): Array<string> {
  const rawAnswers = question.multiple
    ? args.flatMap((arg) => splitCsv(arg))
    : [args.join(" ").trim()];

  if (!question.multiple && rawAnswers.length !== 1) {
    throw new Error(`question "${question.header}" accepts one answer`);
  }

  return rawAnswers.map((answer) => resolveAnswer(question, answer));
}

function splitCsv(arg: string): Array<string> {
  return arg
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function resolveAnswer(
  question: PendingQuestion["questions"][number],
  answer: string,
): string {
  const exact = question.options.find((option) => option.label === answer);
  if (exact) return exact.label;

  const lower = answer.toLowerCase();
  const insensitive = question.options.find(
    (option) => option.label.toLowerCase() === lower,
  );
  if (insensitive) return insensitive.label;

  if (question.custom === true) return answer;

  const labels = question.options.map((option) => option.label).join(", ");
  throw new Error(
    `unknown option "${answer}" for "${question.header}"; available labels: ${labels}`,
  );
}
