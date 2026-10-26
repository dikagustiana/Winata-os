export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  conflict?: boolean;
  data?: Record<string, unknown>;
}

export type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;
