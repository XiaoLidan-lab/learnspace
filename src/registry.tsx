import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import {
  FileText,
  Globe,
  Video,
  Text,
  MessageCircle,
  Languages,
  ListCollapse,
  Network,
  NotebookPen,
  Layers,
  ListTodo,
  ClipboardCheck,
  Timer,
  Calendar,
  StickyNote,
  Image,
} from "lucide-react";
import {
  definitions,
  type ModuleType,
  type ModuleDefinition,
} from "./definitions";
import type { ModuleProps } from "./moduleProps";
import { LegacyBody } from "./LegacyBody";
import {
  TextModule,
  WebModule,
  VideoModule,
  ImageModule,
} from "./InputModules";
import {
  SummaryModule,
  CardsModule,
  TodoModule,
  QuizModule,
  PomodoroModule,
  CalendarModule,
  MindmapModule,
} from "./LearningModules";
export type RegisteredModule = ModuleDefinition & {
  icon: LucideIcon;
  component: ComponentType<ModuleProps>;
};
export const registry: Record<ModuleType, RegisteredModule> = {
  pdf: { ...definitions.pdf, icon: FileText, component: LegacyBody },
  web: { ...definitions.web, icon: Globe, component: WebModule },
  video: { ...definitions.video, icon: Video, component: VideoModule },
  text: { ...definitions.text, icon: Text, component: TextModule },
  chat: { ...definitions.chat, icon: MessageCircle, component: LegacyBody },
  translate: {
    ...definitions.translate,
    icon: Languages,
    component: LegacyBody,
  },
  summary: {
    ...definitions.summary,
    icon: ListCollapse,
    component: SummaryModule,
  },
  mindmap: { ...definitions.mindmap, icon: Network, component: MindmapModule },
  note: { ...definitions.note, icon: NotebookPen, component: LegacyBody },
  cards: { ...definitions.cards, icon: Layers, component: CardsModule },
  todo: { ...definitions.todo, icon: ListTodo, component: TodoModule },
  quiz: { ...definitions.quiz, icon: ClipboardCheck, component: QuizModule },
  pomodoro: { ...definitions.pomodoro, icon: Timer, component: PomodoroModule },
  calendar: {
    ...definitions.calendar,
    icon: Calendar,
    component: CalendarModule,
  },
  sticky: { ...definitions.sticky, icon: StickyNote, component: TextModule },
  image: { ...definitions.image, icon: Image, component: ImageModule },
};
export function ModuleIcon({
  type,
  size = 17,
}: {
  type: ModuleType;
  size?: number;
}) {
  const I = registry[type].icon;
  return (
    <span className={`module-icon ${type}`}>
      <I size={size} />
    </span>
  );
}
