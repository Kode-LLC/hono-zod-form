import { useCallback, useEffect, useMemo, useRef, useState } from 'hono/jsx';

export type FormErrors = Record<string, string | string[]>;

export type SubmissionStatus =
  | 'idle'
  | 'validating'
  | 'submitting'
  | 'success'
  | 'error';

export interface ValidationResult<TValue = unknown> {
  value?: TValue;
  error?: FormErrors;
}

export interface SubmitContext<TValue = unknown> {
  form: HTMLFormElement;
  formData: FormData;
  validation?: ValidationResult<TValue> | null;
  lastResult: ValidationResult<TValue> | null;
  setErrors: (errors: FormErrors) => void;
  setStatus: (status: SubmissionStatus) => void;
}

export interface ValidateContext {
  form: HTMLFormElement;
  formData: FormData;
}

export type FormValidateHandler<TValue = unknown> = (
  context: ValidateContext,
) => ValidationResult<TValue> | Promise<ValidationResult<TValue> | void> | void;

export type FormSubmitHandler<TValue = unknown> = (
  event: SubmitEvent,
  context: SubmitContext<TValue>,
) => void | Promise<void>;

export interface FieldOptions {
  id?: string;
  defaultValue?: unknown;
  value?: unknown;
  required?: boolean;
  ariaDescribedBy?: string;
  type?: 'text' | 'checkbox' | 'radio' | 'select' | 'textarea';
  onInput?: (event: Event) => void;
  onChange?: (event: Event) => void;
  onBlur?: (event: FocusEvent) => void;
}

export interface FieldDescriptor {
  name: string;
  id: string;
  value: unknown;
  defaultValue?: unknown;
  error: string | string[] | null;
  touched: boolean;
  props: FieldProps;
}

export interface FieldProps {
  id: string;
  name: string;
  value?: unknown;
  defaultValue?: unknown;
  required?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'data-conform-error'?: string;
  onInput?: (event: Event) => void;
  onChange?: (event: Event) => void;
  onBlur?: (event: FocusEvent) => void;
}

export interface FormProps {
  id: string;
  noValidate: boolean;
  ref: (form: HTMLFormElement | null) => void;
  onSubmit: (event: SubmitEvent) => void | Promise<void>;
}

export type ShouldValidateMode = 'onSubmit' | 'onBlur' | 'onChange' | 'onInput';

export interface UseFormOptions<TValue = unknown> {
  id?: string;
  shouldValidate?: ShouldValidateMode;
  defaultValue?: Record<string, unknown>;
  lastResult?: ValidationResult<TValue> | null;
  onValidate?: FormValidateHandler<TValue>;
  onSubmit?: FormSubmitHandler<TValue>;
}

export interface FormApi<TValue = unknown> {
  id: string;
  status: SubmissionStatus;
  values: Record<string, unknown>;
  errors: FormErrors;
  touched: Set<string>;
  formProps: FormProps;
  getFormProps: (overrides?: Partial<FormProps>) => FormProps;
  register: (name: string, options?: FieldOptions) => FieldDescriptor;
  getField: (name: string, options?: FieldOptions) => FieldDescriptor;
  setValue: (name: string, value: unknown) => void;
  setErrors: (errors: FormErrors) => void;
  setFieldError: (name: string, error: string | string[] | null) => void;
  clearErrors: () => void;
  validate: () => Promise<ValidationResult<TValue> | null>;
}

export interface UseFormReturn<TValue = unknown> {
  form: FormApi<TValue>;
}

const randomId = () => Math.random().toString(36).slice(2);

const emptyErrors: FormErrors = Object.freeze({});

function normalizeValidationResult<TValue>(
  result: ValidationResult<TValue> | void,
): ValidationResult<TValue> | null {
  if (!result) {
    return null;
  }

  const normalized: ValidationResult<TValue> = {};

  if (result.error && Object.keys(result.error).length > 0) {
    normalized.error = result.error;
  }

  if (result.value !== undefined) {
    normalized.value = result.value;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function mergeValues(
  current: Record<string, unknown>,
  incoming?: Record<string, unknown>,
): Record<string, unknown> {
  if (!incoming) {
    return current;
  }

  return { ...current, ...incoming };
}

function getEventTargetValue(target: EventTarget | null): unknown {
  if (!target || !(target instanceof HTMLElement)) {
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

function isEmptyError(value: string | string[] | null | undefined) {
  if (value == null) {
    return true;
  }

  return Array.isArray(value) ? value.length === 0 : value.length === 0;
}

export function useForm<TValue = unknown>(options: UseFormOptions<TValue> = {}): UseFormReturn<TValue> {
  const formRef = useRef<HTMLFormElement | null>(null);
  const shouldValidate = options.shouldValidate ?? 'onSubmit';

  const [id] = useState(() => options.id ?? `form-${randomId()}`);
  const [status, setStatus] = useState<SubmissionStatus>('idle');
  const [values, setValues] = useState<Record<string, unknown>>(
    () => options.defaultValue ? { ...options.defaultValue } : {},
  );
  const [errors, setErrorsState] = useState<FormErrors>(options.lastResult?.error ?? emptyErrors);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (options.defaultValue) {
      setValues((previous) => mergeValues(previous, options.defaultValue));
    }
  }, [options.defaultValue]);

  useEffect(() => {
    if (options.lastResult) {
      setErrorsState(options.lastResult.error ?? emptyErrors);

      if (options.lastResult.value && typeof options.lastResult.value === 'object') {
        setValues((previous) => mergeValues(previous, options.lastResult?.value as Record<string, unknown>));
      }
    }
  }, [options.lastResult]);

  const setErrors = useCallback((nextErrors: FormErrors) => {
    setErrorsState((current) => {
      const merged = { ...current, ...nextErrors };
      const cleaned: FormErrors = {};

      for (const key of Object.keys(merged)) {
        const error = merged[key];
        if (!isEmptyError(error)) {
          cleaned[key] = error!;
        }
      }

      return Object.keys(cleaned).length > 0 ? cleaned : emptyErrors;
    });
  }, []);

  const clearErrors = useCallback(() => {
    setErrorsState(emptyErrors);
  }, []);

  const setFieldError = useCallback((name: string, error: string | string[] | null) => {
    setErrorsState((current) => {
      if (isEmptyError(error)) {
        if (current === emptyErrors || !(name in current)) {
          return current;
        }

        const next = { ...current };
        delete next[name];
        return Object.keys(next).length > 0 ? next : emptyErrors;
      }

      return { ...current, [name]: error! };
    });
  }, []);

  const setValue = useCallback((name: string, value: unknown) => {
    setValues((current) => ({ ...current, [name]: value }));
  }, []);

  const runValidation = useCallback(
    async (form: HTMLFormElement, formData: FormData): Promise<ValidationResult<TValue> | null> => {
      if (!options.onValidate) {
        return null;
      }

      setStatus('validating');

      const result = await options.onValidate({ form, formData });
      const normalized = normalizeValidationResult(result);

      if (normalized?.error) {
        setErrors(normalized.error);
        setStatus('error');
      } else {
        clearErrors();
        setStatus('success');
      }

      if (normalized?.value && typeof normalized.value === 'object') {
        setValues((previous) => mergeValues(previous, normalized.value as Record<string, unknown>));
      }

      return normalized;
    },
    [options.onValidate, clearErrors, setErrors],
  );

  const validate = useCallback(async () => {
    const form = formRef.current;

    if (!form) {
      return null;
    }

    const formData = new FormData(form);
    return runValidation(form, formData);
  }, [runValidation]);

  const runFieldValidation = useCallback(
    async (name: string) => {
      const form = formRef.current;

      if (!form || !options.onValidate) {
        return;
      }

      const formData = new FormData(form);
      const result = await runValidation(form, formData);

      if (result?.error) {
        setFieldError(name, result.error[name] ?? null);
      } else {
        setFieldError(name, null);
      }
    },
    [options.onValidate, runValidation, setFieldError],
  );

  const formSubmitHandler = useCallback(
    async (event: SubmitEvent) => {
      event.preventDefault();

      const form = formRef.current;

      if (!form) {
        return;
      }

      const formData = new FormData(form);
      let validation: ValidationResult<TValue> | null = null;

      if (options.onValidate) {
        validation = await runValidation(form, formData);

        if (validation?.error && Object.keys(validation.error).length > 0) {
          return;
        }
      }

      if (!options.onSubmit) {
        return;
      }

      setStatus('submitting');

      await options.onSubmit(event, {
        form,
        formData,
        validation,
        lastResult: options.lastResult ?? null,
        setErrors,
        setStatus,
      });
    },
    [options, runValidation, setErrors],
  );

  const handleRef = useCallback((form: HTMLFormElement | null) => {
    formRef.current = form;
  }, []);

  const formProps = useMemo<FormProps>(
    () => ({
      id,
      noValidate: true,
      ref: handleRef,
      onSubmit: formSubmitHandler,
    }),
    [formSubmitHandler, handleRef, id],
  );

  const handleFieldTouched = useCallback((name: string) => {
    setTouched((current) => {
      if (current.has(name)) {
        return current;
      }

      const next = new Set(current);
      next.add(name);
      return next;
    });
  }, []);

  const register = useCallback(
    (name: string, fieldOptions: FieldOptions = {}): FieldDescriptor => {
      const fieldId = fieldOptions.id ?? `${id}-${name}`;
      const error = errors[name] ?? null;
      const value =
        fieldOptions.value !== undefined
          ? fieldOptions.value
          : values[name] ?? fieldOptions.defaultValue;
      const describedBy =
        fieldOptions.ariaDescribedBy ?? (error ? `${fieldId}-error` : undefined);

      const requestValidation = (trigger: 'blur' | 'change' | 'input') => {
        const mode = shouldValidate;

        if (
          (mode === 'onBlur' && trigger === 'blur') ||
          (mode === 'onChange' && trigger === 'change') ||
          (mode === 'onInput' && trigger === 'input')
        ) {
          runFieldValidation(name);
        }
      };

      const handleInput = (event: Event) => {
        const targetValue = getEventTargetValue(event.target);

        if (targetValue !== undefined) {
          setValue(name, targetValue);
        }

        requestValidation('input');
        fieldOptions.onInput?.(event);
      };

      const handleChange = (event: Event) => {
        const targetValue = getEventTargetValue(event.target);

        if (targetValue !== undefined) {
          setValue(name, targetValue);
        }

        requestValidation('change');
        fieldOptions.onChange?.(event);
      };

      const handleBlur = (event: FocusEvent) => {
        handleFieldTouched(name);
        requestValidation('blur');
        fieldOptions.onBlur?.(event);
      };

      const props: FieldProps = {
        id: fieldId,
        name,
        value,
        defaultValue: fieldOptions.defaultValue,
        required: fieldOptions.required,
        'aria-invalid': Boolean(error),
        'aria-describedby': describedBy,
        'data-conform-error': error ? '' : undefined,
        onInput: handleInput,
        onChange: handleChange,
        onBlur: handleBlur,
      };

      return {
        name,
        id: fieldId,
        value,
        defaultValue: fieldOptions.defaultValue,
        error,
        touched: touched.has(name),
        props,
      };
    },
    [errors, handleFieldTouched, id, runFieldValidation, setValue, shouldValidate, touched, values],
  );

  const getField = useCallback(
    (name: string, fieldOptions?: FieldOptions) => register(name, fieldOptions),
    [register],
  );

  const getFormProps = useCallback(
    (overrides: Partial<FormProps> = {}): FormProps => ({
      ...formProps,
      ...overrides,
      ref: overrides.ref ?? formProps.ref,
      onSubmit: overrides.onSubmit ?? formProps.onSubmit,
    }),
    [formProps],
  );

  const api = useMemo<FormApi<TValue>>(
    () => ({
      id,
      status,
      values,
      errors,
      touched,
      formProps,
      getFormProps,
      register,
      getField,
      setValue,
      setErrors,
      setFieldError,
      clearErrors,
      validate,
    }),
    [
      clearErrors,
      errors,
      formProps,
      getFormProps,
      getField,
      id,
      register,
      setErrors,
      setFieldError,
      setValue,
      status,
      touched,
      validate,
      values,
    ],
  );

  return useMemo(
    () => ({
      form: api,
    }),
    [api],
  );
}
