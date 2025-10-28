import { parse } from '@conform-to/dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'hono/jsx';
import type { useForm as ReactUseForm } from '@conform-to/react';

type ReactUseFormReturn<TValue> = ReturnType<ReactUseForm<TValue>>;
type ReactUseFormOptions<TValue> = Parameters<ReactUseForm<TValue>>[0];
type ReactFormState<TValue> = ReactUseFormReturn<TValue>[0];
type ReactFieldset<TValue> = ReactUseFormReturn<TValue>[1];
type ReactFieldMetadata<TValue> = ReactFieldset<TValue> extends Record<string, infer TField>
  ? TField
  : never;
type ReactSubmission<TValue> = ReactFormState<TValue>['submission'];
type ReactSubmissionIntent<TValue> = ReactSubmission<TValue> extends {
  intent: infer TIntent;
}
  ? TIntent
  : never;
type ReactSubmissionErrors<TValue> = ReactSubmission<TValue> extends {
  error?: infer TError;
}
  ? Exclude<TError, undefined>
  : never;
type ReactSubmissionStatus<TValue> = ReactFormState<TValue>['status'];
type ReactFormProps<TValue> = ReactFormState<TValue>['props'];
type ReactFieldProps<TValue> = ReactFieldMetadata<TValue> extends { props: infer TProps }
  ? TProps
  : never;
type ReactValidateFormContext<TValue> = Parameters<
  NonNullable<NonNullable<ReactUseFormOptions<TValue>['onValidate']>>
>[0];
type ReactSubmitContext<TValue> = Parameters<
  NonNullable<ReactUseFormOptions<TValue>['onSubmit']>
>[1];
type ReactShouldValidateMode = NonNullable<ReactUseFormOptions<unknown>['shouldValidate']>;

export type SubmissionIntent<TValue = Record<string, unknown>> = ReactSubmissionIntent<TValue>;
export type SubmissionErrors<TValue = Record<string, unknown>> = ReactSubmissionErrors<TValue>;
export type SubmissionResult<TValue = Record<string, unknown>> = ReactSubmission<TValue>;
export type SubmissionStatus<TValue = Record<string, unknown>> = ReactSubmissionStatus<TValue>;
export type ShouldValidateMode = ReactShouldValidateMode;
export type FormProps<TValue = Record<string, unknown>> = ReactFormProps<TValue>;
export type FieldProps<TValue = Record<string, unknown>> = ReactFieldProps<TValue>;
export type FieldMetadata<TValue = Record<string, unknown>> = ReactFieldMetadata<TValue>;
export type Fieldset<TValue = Record<string, unknown>> = ReactFieldset<TValue>;
export type ValidateFormContext<TValue = Record<string, unknown>> = ReactValidateFormContext<TValue>;
export type SubmitContext<TValue = Record<string, unknown>> = ReactSubmitContext<TValue>;
export type FieldOptions = Partial<FieldProps> & {
  id?: string;
  defaultValue?: unknown;
  value?: unknown;
  type?: string;
  ariaDescribedBy?: string;
};
export type UseFormOptions<TValue = Record<string, unknown>> = ReactUseFormOptions<TValue>;
export type FormState<TValue = Record<string, unknown>> = ReactFormState<TValue>;

const emptyFieldErrors: Record<string, string | string[] | undefined> = Object.freeze({});
const emptyFormErrors: string[] = Object.freeze([]);

function randomId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

function isEmptyError(value: string | string[] | undefined) {
  if (value == null) {
    return true;
  }

  return Array.isArray(value) ? value.length === 0 : value.length === 0;
}

function normalizeFieldErrors(
  incoming?: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  if (!incoming) {
    return emptyFieldErrors;
  }

  const result: Record<string, string | string[] | undefined> = {};

  for (const [name, value] of Object.entries(incoming)) {
    if (!isEmptyError(value)) {
      result[name] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : emptyFieldErrors;
}

function normalizeFormErrors(incoming?: string[] | null): string[] {
  if (!incoming || incoming.length === 0) {
    return emptyFormErrors;
  }

  const filtered = incoming.filter(Boolean);
  return filtered.length > 0 ? filtered : emptyFormErrors;
}

function hasSubmissionError(error?: SubmissionErrors | null) {
  if (!error) {
    return false;
  }

  if (error.formErrors && error.formErrors.some(Boolean)) {
    return true;
  }

  if (error.fieldErrors) {
    for (const value of Object.values(error.fieldErrors)) {
      if (!isEmptyError(value)) {
        return true;
      }
    }
  }

  return false;
}

function getEventValue(target: EventTarget | null): unknown {
  if (!(target instanceof HTMLElement)) {
    return undefined;
  }

  if (target instanceof HTMLInputElement) {
    if (target.type === 'checkbox') {
      return target.checked;
    }

    if (target.type === 'radio') {
      return target.value;
    }

    return target.value;
  }

  if (target instanceof HTMLSelectElement) {
    if (target.multiple) {
      return Array.from(target.selectedOptions).map((option) => option.value);
    }

    return target.value;
  }

  if (target instanceof HTMLTextAreaElement) {
    return target.value;
  }

  return undefined;
}

function normalizeSubmissionResult<TValue>(
  intent: SubmissionIntent,
  result: SubmissionResult<TValue> | void,
  fallback: SubmissionResult<TValue> | null,
): SubmissionResult<TValue> | null {
  if (!result) {
    return fallback;
  }

  if (!result.intent) {
    return { ...result, intent };
  }

  return result;
}

export function useForm<TValue = Record<string, unknown>>(
  options: UseFormOptions<TValue> = {},
): [FormState<TValue>, Fieldset] {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [formId] = useState(() => options.id ?? randomId('form'));
  const shouldValidate = options.shouldValidate ?? 'onSubmit';
  const shouldRevalidate = options.shouldRevalidate ?? shouldValidate;

  const initialValuesRef = useRef<Record<string, unknown>>(
    options.defaultValue ? { ...(options.defaultValue as Record<string, unknown>) } : {},
  );

  const [values, setValues] = useState<Record<string, unknown>>(
    () => ({ ...initialValuesRef.current }),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | string[] | undefined>>(
    () => (options.lastSubmission?.error?.fieldErrors
      ? normalizeFieldErrors(options.lastSubmission.error.fieldErrors)
      : emptyFieldErrors),
  );
  const [formErrors, setFormErrors] = useState<string[]>(() =>
    options.lastSubmission?.error?.formErrors
      ? normalizeFormErrors(options.lastSubmission.error.formErrors)
      : emptyFormErrors,
  );
  const [status, setStatus] = useState<SubmissionStatus>('idle');
  const [submission, setSubmission] = useState<SubmissionResult<TValue> | null>(
    options.lastSubmission ?? null,
  );
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [dirty, setDirty] = useState<Set<string>>(() => new Set());
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const valuesRef = useRef(values);
  const fieldErrorsRef = useRef(fieldErrors);
  const formErrorsRef = useRef(formErrors);

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  useEffect(() => {
    fieldErrorsRef.current = fieldErrors;
  }, [fieldErrors]);

  useEffect(() => {
    formErrorsRef.current = formErrors;
  }, [formErrors]);

  useEffect(() => {
    if (!options.defaultValue) {
      return;
    }

    initialValuesRef.current = {
      ...initialValuesRef.current,
      ...(options.defaultValue as Record<string, unknown>),
    };

    setValues((current) => ({ ...initialValuesRef.current, ...current }));
  }, [options.defaultValue]);

  useEffect(() => {
    if (!options.lastSubmission) {
      return;
    }

    const last = options.lastSubmission;
    setSubmission(last);

    if (last.value && typeof last.value === 'object') {
      setValues((current) => ({ ...current, ...(last.value as Record<string, unknown>) }));
    }

    if (last.error) {
      setFieldErrors(normalizeFieldErrors(last.error.fieldErrors));
      setFormErrors(normalizeFormErrors(last.error.formErrors ?? null));
      setStatus(hasSubmissionError(last.error) ? 'error' : 'success');
    } else {
      setFieldErrors(emptyFieldErrors);
      setFormErrors(emptyFormErrors);
      setStatus('success');
    }
  }, [options.lastSubmission]);

  const markDirty = useCallback((name: string, value: unknown) => {
    setDirty((current) => {
      const initial = initialValuesRef.current[name];
      const isDirty = !Object.is(initial, value);

      if (isDirty) {
        if (current.has(name)) {
          return current;
        }

        const next = new Set(current);
        next.add(name);
        return next;
      }

      if (!current.has(name)) {
        return current;
      }

      const next = new Set(current);
      next.delete(name);
      return next;
    });
  }, []);

  const setValue = useCallback(
    (name: string, value: unknown) => {
      setValues((current) => {
        if (Object.is(current[name], value)) {
          return current;
        }

        const next = { ...current, [name]: value };
        return next;
      });

      markDirty(name, value);
    },
    [markDirty],
  );

  const setFieldError = useCallback((name: string, error: string | string[] | undefined) => {
    setFieldErrors((current) => {
      if (isEmptyError(error)) {
        if (current === emptyFieldErrors || !(name in current)) {
          return current;
        }

        const next = { ...current };
        delete next[name];
        return Object.keys(next).length > 0 ? next : emptyFieldErrors;
      }

      return { ...current, [name]: error };
    });
  }, []);

  const clearErrors = useCallback(() => {
    setFieldErrors(emptyFieldErrors);
    setFormErrors(emptyFormErrors);
  }, []);

  const applySubmission = useCallback(
    (result: SubmissionResult<TValue> | null, nextStatus?: SubmissionStatus) => {
      if (!result) {
        setSubmission(null);
        clearErrors();
        if (nextStatus) {
          setStatus(nextStatus);
        }
        return;
      }

      setSubmission(result);

      if (result.error) {
        setFieldErrors(normalizeFieldErrors(result.error.fieldErrors));
        setFormErrors(normalizeFormErrors(result.error.formErrors ?? null));
      } else {
        clearErrors();
      }

      if (result.value && typeof result.value === 'object') {
        const valueRecord = result.value as Record<string, unknown>;
        setValues((current) => ({ ...current, ...valueRecord }));
        for (const [name, value] of Object.entries(valueRecord)) {
          markDirty(name, value);
        }
      }

      if (nextStatus) {
        setStatus(nextStatus);
      } else if (result.error && hasSubmissionError(result.error)) {
        setStatus('error');
      } else {
        setStatus('success');
      }
    },
    [clearErrors, markDirty],
  );

  const runValidation = useCallback(
    async (intent: SubmissionIntent, form: HTMLFormElement, formData: FormData) => {
      if (!options.onValidate) {
        return null;
      }

      setStatus('validating');

      let parsedSubmission: SubmissionResult<TValue> | null = null;

      try {
        parsedSubmission = parse(formData) as SubmissionResult<TValue>;
      } catch {
        parsedSubmission = null;
      }

      const stateSubmission: SubmissionResult<TValue> =
        submission ??
        ({
          intent,
          value: valuesRef.current as unknown as TValue,
          error: {
            formErrors: formErrorsRef.current,
            fieldErrors: fieldErrorsRef.current,
          },
        } as SubmissionResult<TValue>);

      const fallbackSubmission: SubmissionResult<TValue> =
        parsedSubmission ?? stateSubmission;
      const resolvedIntent = (fallbackSubmission.intent ?? intent) as SubmissionIntent;

      const context: ValidateFormContext<TValue> = {
        form,
        formData,
        submission: {
          ...fallbackSubmission,
          intent: resolvedIntent,
        },
        intent: resolvedIntent,
      };

      const result = await options.onValidate(context);
      const normalized = normalizeSubmissionResult(
        resolvedIntent,
        result,
        parsedSubmission ?? fallbackSubmission,
      );

      applySubmission(
        normalized,
        normalized?.error && hasSubmissionError(normalized.error) ? 'error' : 'success',
      );

      return normalized;
    },
    [
      applySubmission,
      fieldErrorsRef,
      formErrorsRef,
      options.onValidate,
      submission,
      valuesRef,
    ],
  );

  const validate = useCallback(async () => {
    const form = formRef.current;
    if (!form) {
      return null;
    }

    return runValidation({ type: 'validate' }, form, new FormData(form));
  }, [runValidation]);

  const runFieldValidation = useCallback(
    async (name: string, trigger: 'blur' | 'change' | 'input') => {
      const form = formRef.current;

      if (!form || !options.onValidate) {
        return;
      }

      const intent: SubmissionIntent = {
        type: 'validate',
        payload: { field: name, trigger },
      };

      const result = await runValidation(intent, form, new FormData(form));

      if (result?.error?.fieldErrors) {
        setFieldError(name, result.error.fieldErrors[name]);
      } else {
        setFieldError(name, undefined);
      }
    },
    [options.onValidate, runValidation, setFieldError],
  );

  const shouldTriggerValidation = useCallback(
    (trigger: 'blur' | 'change' | 'input') => {
      const mode = hasSubmitted ? shouldRevalidate : shouldValidate;

      if (mode === 'onSubmit') {
        return false;
      }

      if (mode === 'onBlur' && trigger === 'blur') {
        return true;
      }

      if (mode === 'onChange' && trigger === 'change') {
        return true;
      }

      if (mode === 'onInput' && trigger === 'input') {
        return true;
      }

      return false;
    },
    [hasSubmitted, shouldRevalidate, shouldValidate],
  );

  const handleSubmit = useCallback(
    async (event: SubmitEvent) => {
      event.preventDefault();

      const form = formRef.current;
      if (!form) {
        return;
      }

      const formData = new FormData(form);
      const intent: SubmissionIntent = { type: 'submit' };

      setHasSubmitted(true);

      let nextSubmission: SubmissionResult<TValue> | null = null;

      if (options.onValidate) {
        nextSubmission = await runValidation(intent, form, formData);

        if (nextSubmission?.error && hasSubmissionError(nextSubmission.error)) {
          return;
        }
      }

      let parsedSubmission: SubmissionResult<TValue> | null = null;

      try {
        parsedSubmission = parse(formData) as SubmissionResult<TValue>;
      } catch {
        parsedSubmission = null;
      }

      const fallbackSubmission: SubmissionResult<TValue> =
        parsedSubmission ??
        (submission ??
          ({
            intent,
            value: valuesRef.current as unknown as TValue,
            error: submission?.error ?? null,
          } as SubmissionResult<TValue>));

      const finalSubmission: SubmissionResult<TValue> = nextSubmission ?? fallbackSubmission;

      setStatus('submitting');
      setSubmission(finalSubmission);

      if (options.onSubmit) {
        await options.onSubmit(event, {
          form,
          formData,
          submission: finalSubmission,
        });
      }

      setStatus('success');
    },
    [options.onSubmit, options.onValidate, runValidation, submission, valuesRef],
  );

  const handleRef = useCallback((element: HTMLFormElement | null) => {
    formRef.current = element;
  }, []);

  const handleTouched = useCallback((name: string) => {
    setTouched((current) => {
      if (current.has(name)) {
        return current;
      }

      const next = new Set(current);
      next.add(name);
      return next;
    });
  }, []);

  const createFieldMetadata = useCallback(
    (name: string, fieldOptions: FieldOptions = {}): FieldMetadata => {
      const fieldId = fieldOptions.id ?? `${formId}-${name}`;
      const initialValue = initialValuesRef.current[name];
      const currentValue =
        fieldOptions.value !== undefined ? fieldOptions.value : values[name] ?? fieldOptions.defaultValue;
      const fieldError = fieldErrors[name];
      const errors = fieldError
        ? Array.isArray(fieldError)
          ? fieldError.filter(Boolean)
          : [fieldError]
        : [];
      const error = errors[0];
      const describedBy = fieldOptions.ariaDescribedBy ?? (error ? `${fieldId}-error` : undefined);
      const isTouched = touched.has(name);
      const isDirty = dirty.has(name);

      const requestValidation = (trigger: 'blur' | 'change' | 'input') => {
        if (shouldTriggerValidation(trigger)) {
          runFieldValidation(name, trigger);
        }
      };

      const handleInput = (event: Event) => {
        const value = getEventValue(event.target);
        if (value !== undefined) {
          setValue(name, value);
        }

        requestValidation('input');
        fieldOptions.onInput?.(event);
      };

      const handleChange = (event: Event) => {
        const value = getEventValue(event.target);
        if (value !== undefined) {
          setValue(name, value);
        }

        requestValidation('change');
        fieldOptions.onChange?.(event);
      };

      const handleBlur = (event: FocusEvent) => {
        handleTouched(name);
        requestValidation('blur');
        fieldOptions.onBlur?.(event);
      };

      const props: FieldProps = {
        id: fieldId,
        name,
        value: fieldOptions.value !== undefined ? fieldOptions.value : currentValue,
        defaultValue: fieldOptions.defaultValue ?? initialValue,
        required: fieldOptions.required,
        'aria-invalid': Boolean(error),
        'aria-describedby': describedBy,
        'data-conform-invalid': error ? '' : undefined,
        'data-conform-dirty': isDirty ? '' : undefined,
        'data-conform-touched': isTouched ? '' : undefined,
        onInput: handleInput,
        onChange: handleChange,
        onBlur: handleBlur,
      };

      return {
        id: fieldId,
        name,
        type: fieldOptions.type ?? 'text',
        value: props.value,
        defaultValue: props.defaultValue,
        initialValue,
        dirty: isDirty,
        touched: isTouched,
        valid: !error,
        error: error ?? undefined,
        errors,
        required: fieldOptions.required,
        props,
      };
    },
    [dirty, fieldErrors, formId, handleTouched, runFieldValidation, setValue, shouldTriggerValidation, touched, values],
  );

  const fields = useMemo(
    () =>
      new Proxy<Record<string, FieldMetadata>>(
        {},
        {
          get: (_, key: string) => createFieldMetadata(key),
        },
      ),
    [createFieldMetadata],
  );

  const formProps = useMemo<FormProps>(
    () => ({
      id: formId,
      noValidate: true,
      ref: handleRef,
      onSubmit: handleSubmit,
    }),
    [formId, handleRef, handleSubmit],
  );

  const reset = useCallback(() => {
    setValues({ ...initialValuesRef.current });
    setDirty(new Set());
    setTouched(new Set());
    setSubmission(null);
    clearErrors();
    setStatus('idle');
    setHasSubmitted(false);
  }, [clearErrors]);

  const formState = useMemo<FormState<TValue>>(
    () => ({
      id: formId,
      submission,
      lastSubmission: options.lastSubmission ?? null,
      status,
      submitting: status === 'submitting',
      valid: !hasSubmissionError(submission?.error ?? null),
      dirty: dirty.size > 0,
      touched: touched.size > 0,
      error: formErrors[0] ?? null,
      errors: formErrors,
      fields,
      props: formProps,
      getFieldset: () => fields,
      reset,
    }),
    [dirty.size, fields, formErrors, formId, formProps, options.lastSubmission, reset, status, submission, touched.size],
  );

  return useMemo(() => [formState, fields], [fields, formState]);
}

export type UseFormReturn<TValue = Record<string, unknown>> = [
  FormState<TValue>,
  Fieldset<TValue>,
];
