import { Type, type TUnsafe } from 'typebox';
import { ETA_OUTCOMES } from './types';

function stringEnum<T extends readonly string[]>(
  values: T,
  options?: { description?: string },
): TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>({
    type: 'string',
    enum: values,
    ...(options?.description ? { description: options.description } : {}),
  });
}

export const EstimateInputSchema = {
  taskSummary: Type.String({
    minLength: 1,
    description: 'Concise description of the task being estimated.',
  }),
  estimateMinutes: Type.Optional(
    Type.Number({
      minimum: 0.001,
      description:
        'Single estimate in minutes. Use either this or estimateLowMinutes/estimateHighMinutes.',
    }),
  ),
  estimateLowMinutes: Type.Optional(
    Type.Number({
      minimum: 0.001,
      description:
        'Low end of the estimate range in minutes. Must be paired with estimateHighMinutes.',
    }),
  ),
  estimateHighMinutes: Type.Optional(
    Type.Number({
      minimum: 0.001,
      description:
        'High end of the estimate range in minutes. Must be paired with estimateLowMinutes.',
    }),
  ),
};

export const EtaCheckParamsSchema = Type.Object(EstimateInputSchema, {
  additionalProperties: false,
});

const DelegatedTasksSchema = Type.Optional(
  Type.Array(
    Type.Object(
      {
        taskSummary: Type.String({ minLength: 1, maxLength: 160 }),
        estimateMinutes: Type.Number({ minimum: 0.001 }),
      },
      { additionalProperties: false },
    ),
    {
      maxItems: 16,
      description:
        'Raw remaining estimates for delegated tasks, already included in your total ETA. Parallel work uses the longest critical path, not the sum. Pass [] to clear finished subagents on update.',
    },
  ),
);

export const EtaStartParamsSchema = Type.Object(
  { ...EstimateInputSchema, delegatedTasks: DelegatedTasksSchema },
  {
    additionalProperties: false,
  },
);

export const EtaUpdateParamsSchema = Type.Object(
  {
    estimateMinutes: EstimateInputSchema.estimateMinutes,
    estimateLowMinutes: EstimateInputSchema.estimateLowMinutes,
    estimateHighMinutes: EstimateInputSchema.estimateHighMinutes,
    delegatedTasks: DelegatedTasksSchema,
    taskId: Type.Optional(
      Type.String({
        description:
          'Omit to update the open ETA task in this session. Other sessions cannot be updated.',
      }),
    ),
  },
  { additionalProperties: false },
);

export const EtaFinishParamsSchema = Type.Object(
  {
    taskId: Type.Optional(
      Type.String({
        description:
          'ETA task id returned by eta_start. Omit to finish the open task in this session.',
      }),
    ),
    outcome: Type.Optional(
      stringEnum(ETA_OUTCOMES, {
        description:
          'Task outcome; defaults to completed. completed means the exact task in taskSummary was finished; use scope_changed when work stopped short of it. Only completed tasks affect calibration; abandoned/scope_changed/superseded close the timer without training.',
      }),
    ),
    note: Type.Optional(
      Type.String({ description: 'Optional short note about the finish outcome.' }),
    ),
  },
  { additionalProperties: false },
);

export type EstimateInputParams = {
  taskSummary: string;
  estimateMinutes?: number;
  estimateLowMinutes?: number;
  estimateHighMinutes?: number;
};
