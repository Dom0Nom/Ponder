import { create } from "zustand";
import type { QuizQuestion } from "../lib/types";

interface QuizRequest {
  title: string;
  intro?: string;
  questions: QuizQuestion[];
  resolve: (answers: (number | null)[] | null) => void;
}

interface QuizStore {
  current: QuizRequest | null;
  /** status line while questions are being generated */
  preparing: string | null;
  setPreparing: (p: string | null) => void;
  /** shows the quiz dialog; resolves with the answers, or null if the learner closed it */
  ask: (title: string, questions: QuizQuestion[], intro?: string) => Promise<(number | null)[] | null>;
  finish: (answers: (number | null)[] | null) => void;
}

export const useQuiz = create<QuizStore>((set, get) => ({
  current: null,
  preparing: null,
  setPreparing: (preparing) => set({ preparing }),
  ask: (title, questions, intro) =>
    new Promise((resolve) => set({ current: { title, questions, intro, resolve }, preparing: null })),
  finish: (answers) => {
    get().current?.resolve(answers);
    set({ current: null });
  },
}));
