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

export const EtaStartParamsSchema = Type.Object(EstimateInputSchema, {
  additionalProperties: false,
});

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
          'Task outcome; defaults to completed. Only completed tasks affect calibration; abandoned/scope_changed/superseded close the timer without training.',
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
