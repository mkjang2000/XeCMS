import { useEffect, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { Navigate, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Callout, LoadingIndicator, TextInput } from "@xecms/ui";
import { toAdminApiError, useAdminApi, type AuthCredentials } from "@xecms/admin";
import { Icon } from "../components/icon.js";
import styles from "../auth.module.css";
import { queryKeys } from "../queries.js";

interface SetupValues extends AuthCredentials {
  readonly passwordConfirmation: string;
}

function AuthLayout({ title, description, children }: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <main className={styles.authPage}>
      <aside className={styles.authVisual} aria-label="XeCMS Admin Studio 소개">
        <div className={styles.visualBrand}>
          <span className={styles.brandMark} aria-hidden="true">Xe</span>
          <span className={styles.brandName}>XeCMS Admin Studio</span>
        </div>
        <div className={styles.visualContent}>
          <span className={styles.visualEyebrow}>Structured content workspace</span>
          <h2>콘텐츠의 구조와 운영을 한곳에서.</h2>
          <p>스키마 설계부터 콘텐츠 관리까지, 개발자에게 필요한 흐름을 명확하고 안전하게 연결합니다.</p>
          <ul className={styles.featureList}>
            <li><span className={styles.featureIcon}><Icon name="schema" size={16} /></span>예측 가능한 스키마 설계</li>
            <li><span className={styles.featureIcon}><Icon name="database" size={16} /></span>검토 가능한 데이터베이스 변경</li>
            <li><span className={styles.featureIcon}><Icon name="shield" size={16} /></span>운영 경계를 지키는 안전한 기본값</li>
          </ul>
        </div>
        <span className={styles.visualFooter}>XeCMS · Developer-first content management</span>
      </aside>
      <div className={styles.authContent}>
        <section className={styles.authCard}>
          <header className={styles.authHeader}>
            <p className={styles.authEyebrow}>Workspace access</p>
            <h1>{title}</h1>
            <p className={styles.muted}>{description}</p>
          </header>
          {children}
          <footer className={styles.authFootnote}>
            <Icon name="shield" size={15} />
            <span>보호된 세션으로 Admin Workspace에 연결합니다.</span>
          </footer>
        </section>
      </div>
    </main>
  );
}

export function SetupPage() {
  const api = useAdminApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.bootstrap, queryFn: () => api.auth.getBootstrapStatus() });
  const { control, handleSubmit, watch, setError, setFocus } = useForm<SetupValues>({
    defaultValues: { username: "", password: "", passwordConfirmation: "" },
  });
  const mutation = useMutation({
    mutationFn: ({ username, password }: SetupValues) => api.auth.bootstrap({ username, password }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
        queryClient.invalidateQueries({ queryKey: queryKeys.session }),
      ]);
      navigate("/admin/schema", { replace: true });
    },
    onError: (error) => {
      const apiError = toAdminApiError(error);
      let focused = false;
      Object.entries(apiError.fieldErrors).forEach(([path, message]) => {
        if (path.endsWith("username")) {
          setError("username", { message }, { shouldFocus: !focused });
          focused = true;
        } else if (path.endsWith("password")) {
          setError("password", { message }, { shouldFocus: !focused });
          focused = true;
        }
      });
      if (!focused) setFocus("username");
    },
  });

  if (status.isPending) return <AuthLayout title="초기 관리자 설정" description="XeCMS를 준비하고 있습니다."><LoadingIndicator /></AuthLayout>;
  if (status.isError) return <AuthLayout title="초기 관리자 설정" description="서버 연결을 확인해 주세요."><Callout tone="error">{toAdminApiError(status.error).message}</Callout></AuthLayout>;
  if (!status.data.required) return <Navigate to="/admin/login" replace />;

  const apiError = mutation.isError ? toAdminApiError(mutation.error) : null;
  return (
    <AuthLayout title="초기 관리자 설정" description="이 작업은 빈 인스턴스에서 한 번만 수행할 수 있습니다.">
      {apiError ? <Callout tone="error">{apiError.message}</Callout> : null}
      <form aria-label="초기 관리자 설정" className={styles.form} onSubmit={handleSubmit((values) => mutation.mutate(values))}>
        <Controller
          control={control}
          name="username"
          rules={{ required: "사용자 이름을 입력해 주세요." }}
          render={({ field: { ref, ...field }, fieldState }) => (
            <TextInput inputRef={ref} label="사용자 이름" autoComplete="username" isRequired errorMessage={fieldState.error?.message} {...field} />
          )}
        />
        <Controller
          control={control}
          name="password"
          rules={{
            required: "비밀번호를 입력해 주세요.",
            minLength: { value: 12, message: "비밀번호는 12자 이상이어야 합니다." },
            maxLength: { value: 128, message: "비밀번호는 128자 이하여야 합니다." },
          }}
          render={({ field: { ref, ...field }, fieldState }) => (
            <TextInput
              inputRef={ref}
              label="비밀번호"
              type="password"
              autoComplete="new-password"
              isRequired
              description="12자 이상 128자 이하로 입력하세요. admin/admin은 개발 seed에서만 사용할 수 있습니다."
              errorMessage={fieldState.error?.message}
              {...field}
            />
          )}
        />
        <Controller
          control={control}
          name="passwordConfirmation"
          rules={{
            required: "비밀번호를 다시 입력해 주세요.",
            validate: (value) => value === watch("password") || "비밀번호가 일치하지 않습니다.",
          }}
          render={({ field: { ref, ...field }, fieldState }) => (
            <TextInput
              inputRef={ref}
              label="비밀번호 확인"
              type="password"
              autoComplete="new-password"
              isRequired
              errorMessage={fieldState.error?.message}
              {...field}
            />
          )}
        />
        <Button type="submit" isDisabled={mutation.isPending}>
          {mutation.isPending ? "생성 중…" : "초기 관리자 생성"}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function LoginPage() {
  const api = useAdminApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.bootstrap, queryFn: () => api.auth.getBootstrapStatus() });
  const session = useQuery({ queryKey: queryKeys.session, queryFn: () => api.auth.getSession(), retry: false });
  const { control, handleSubmit, setError, setFocus } = useForm<AuthCredentials>({
    defaultValues: { username: "", password: "" },
  });
  const mutation = useMutation({
    mutationFn: (credentials: AuthCredentials) => api.auth.login(credentials),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      navigate("/admin/schema", { replace: true });
    },
    onError: (error) => {
      const apiError = toAdminApiError(error);
      if (apiError.status === 401) {
        setError("username", { message: "사용자 이름 또는 비밀번호가 올바르지 않습니다." });
        setFocus("username");
      }
    },
  });

  useEffect(() => {
    if (mutation.isError && toAdminApiError(mutation.error).status !== 401) setFocus("username");
  }, [mutation.error, mutation.isError, setFocus]);

  if (status.data?.required) return <Navigate to="/admin/setup" replace />;
  if (session.data?.user) return <Navigate to="/admin/schema" replace />;
  const apiError = mutation.isError ? toAdminApiError(mutation.error) : null;

  return (
    <AuthLayout title="Admin Studio 로그인" description="XeCMS 운영 계정으로 로그인하세요.">
      {apiError && apiError.status !== 401 ? <Callout tone="error">{apiError.message}</Callout> : null}
      <form aria-label="로그인" className={styles.form} onSubmit={handleSubmit((values) => mutation.mutate(values))}>
        <Controller
          control={control}
          name="username"
          rules={{ required: "사용자 이름을 입력해 주세요." }}
          render={({ field: { ref, ...field }, fieldState }) => (
            <TextInput inputRef={ref} label="사용자 이름" autoComplete="username" isRequired errorMessage={fieldState.error?.message} {...field} />
          )}
        />
        <Controller
          control={control}
          name="password"
          rules={{ required: "비밀번호를 입력해 주세요." }}
          render={({ field: { ref, ...field }, fieldState }) => (
            <TextInput
              inputRef={ref}
              label="비밀번호"
              type="password"
              autoComplete="current-password"
              isRequired
              errorMessage={fieldState.error?.message}
              {...field}
            />
          )}
        />
        <Button type="submit" isDisabled={mutation.isPending}>
          {mutation.isPending ? "로그인 중…" : "로그인"}
        </Button>
      </form>
    </AuthLayout>
  );
}
