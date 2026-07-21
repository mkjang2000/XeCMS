import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { Navigate, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Callout, CheckboxField, LoadingIndicator, TextInput } from "@xecms/ui";
import { toAdminApiError, useAdminApi, type AuthCredentials } from "@xecms/admin";
import { STARTER_TEMPLATES, starterSchema, starterTemplate, type StarterName } from "@xecms/schema";
import { Icon } from "../components/icon.js";
import styles from "../auth.module.css";
import { queryKeys } from "../queries.js";

interface SetupValues extends AuthCredentials {
  readonly passwordConfirmation: string;
}

function defaultCollectionLabel(collection: { readonly name: string; readonly label?: string }): string {
  return collection.label ?? collection.name;
}

function AuthLayout({ title, description, children, wide = false }: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly wide?: boolean;
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
        <section className={`${styles.authCard} ${wide ? styles.authCardWide : ""}`}>
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
  const session = useQuery({
    queryKey: queryKeys.session,
    queryFn: () => api.auth.getSession(),
    enabled: status.data?.required === false,
    retry: false,
  });
  const [step, setStep] = useState<"account" | "template" | "customize" | "review">("account");
  const [selectedStarter, setSelectedStarter] = useState<StarterName>("minimal");
  const [enabledModuleIds, setEnabledModuleIds] = useState<readonly string[]>([]);
  const [collectionLabels, setCollectionLabels] = useState<Readonly<Record<string, string>>>({});
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
      setStep("template");
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

  const applyTemplate = useMutation({
    mutationFn: () => api.auth.applySetupTemplate({
      starter: selectedStarter,
      enabledModuleIds,
      collectionLabels: Object.fromEntries(
        starterSchema(selectedStarter, { enabledModuleIds }).collections.map((collection) => [
          String(collection.id),
          collectionLabels[String(collection.id)] ?? defaultCollectionLabel(collection),
        ]),
      ),
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
        queryClient.invalidateQueries({ queryKey: queryKeys.session }),
      ]);
      navigate("/admin/schema", { replace: true });
    },
  });

  useEffect(() => {
    if (status.data?.required === false && status.data.templateRequired && session.data?.user) {
      setStep((current) => current === "account" ? "template" : current);
    }
  }, [session.data?.user, status.data?.required, status.data?.templateRequired]);

  if (status.isPending) return <AuthLayout title="초기 관리자 설정" description="XeCMS를 준비하고 있습니다."><LoadingIndicator /></AuthLayout>;
  if (status.isError) return <AuthLayout title="초기 관리자 설정" description="서버 연결을 확인해 주세요."><Callout tone="error">{toAdminApiError(status.error).message}</Callout></AuthLayout>;
  if (!status.data.required && session.isPending) return <AuthLayout title="초기 설정 계속하기" description="설정 상태를 확인하고 있습니다."><LoadingIndicator /></AuthLayout>;
  if (!status.data.required && session.data?.user === null) return <Navigate to="/admin/login" replace />;
  if (!status.data.templateRequired) return <Navigate to="/admin/schema" replace />;

  const apiError = mutation.isError ? toAdminApiError(mutation.error) : null;
  const selectedTemplate = starterTemplate(selectedStarter);
  const previewSchema = starterSchema(selectedStarter, { enabledModuleIds });
  const labelsValid = previewSchema.collections.every((collection) => {
    const value = collectionLabels[String(collection.id)] ?? defaultCollectionLabel(collection);
    return value.trim().length >= 1 && value.trim().length <= 80;
  });
  const steps = ["관리자 계정", "템플릿 선택", "간단 커스텀", "확인 및 적용"];
  const currentStep = { account: 0, template: 1, customize: 2, review: 3 }[step];

  const chooseStarter = (starter: StarterName) => {
    const template = starterTemplate(starter);
    setSelectedStarter(starter);
    setEnabledModuleIds(template.modules.filter(({ defaultEnabled }) => defaultEnabled).map(({ id }) => id));
    setCollectionLabels({});
  };

  return (
    <AuthLayout wide title="초기 관리자 설정" description="관리자 계정과 첫 콘텐츠 구조를 단계별로 구성합니다.">
      <ol className={styles.setupProgress} aria-label="초기 설정 진행 단계">
        {steps.map((label, index) => <li key={label} data-state={index < currentStep ? "done" : index === currentStep ? "current" : "todo"}>
          <span>{index < currentStep ? "✓" : index + 1}</span><strong>{label}</strong>
        </li>)}
      </ol>
      {step === "account" ? <>
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
              description="12자 이상 128자 이하의 고유한 비밀번호를 입력하세요."
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
          {mutation.isPending ? "생성 중…" : "관리자 생성 후 계속"}
        </Button>
        </form>
      </> : null}
      {step === "template" ? <div className={styles.setupBody}>
        <div className={styles.templateGrid}>
          {STARTER_TEMPLATES.map((template) => <button
            key={template.id}
            type="button"
            className={styles.templateCard}
            data-selected={selectedStarter === template.id}
            aria-pressed={selectedStarter === template.id}
            onClick={() => chooseStarter(template.id)}
          >
            <span className={styles.templateMark}>{template.id === "minimal" ? "＋" : template.id === "blog" ? "B" : "C"}</span>
            <strong>{template.label}</strong><small>{template.description}</small>
          </button>)}
        </div>
        <div className={styles.setupActions}><Button onPress={() => setStep("customize")}>이 템플릿으로 계속</Button></div>
      </div> : null}
      {step === "customize" ? <div className={styles.setupBody}>
        <div className={styles.customizeSection}>
          <h2>{selectedTemplate.label} 구성</h2>
          {selectedTemplate.modules.length === 0
            ? <Callout tone="info">빈 프로젝트는 선택 기능 없이 시작합니다. 설치 후 Schema 편집기에서 컬렉션을 추가할 수 있습니다.</Callout>
            : <div className={styles.moduleList}>{selectedTemplate.modules.map((module) => <div key={module.id} className={styles.moduleOption}>
              <CheckboxField
                isSelected={enabledModuleIds.includes(module.id)}
                onChange={(selected) => setEnabledModuleIds((current) => selected
                  ? [...current, module.id]
                  : current.filter((id) => id !== module.id))}
              ><strong>{module.label}</strong></CheckboxField>
              <p>{module.description}</p>
            </div>)}</div>}
        </div>
        {previewSchema.collections.length > 0 ? <div className={styles.customizeSection}>
          <h2>컬렉션 표시 이름</h2>
          <p>코드에서 사용하는 기술 이름과 ID는 유지되고 Admin에 보이는 이름만 바뀝니다.</p>
          <div className={styles.labelGrid}>{previewSchema.collections.map((collection) => <TextInput
            key={collection.id}
            label={`${collection.name} 표시 이름`}
            value={collectionLabels[String(collection.id)] ?? defaultCollectionLabel(collection)}
            onChange={(value) => setCollectionLabels((current) => ({ ...current, [String(collection.id)]: value }))}
            errorMessage={(() => { const value = collectionLabels[String(collection.id)] ?? defaultCollectionLabel(collection); return value.trim().length < 1 || value.trim().length > 80 ? "1자 이상 80자 이하로 입력해 주세요." : undefined; })()}
          />)}</div>
        </div> : null}
        <div className={styles.setupActions}>
          <Button variant="secondary" onPress={() => setStep("template")}>이전</Button>
          <Button isDisabled={!labelsValid} onPress={() => setStep("review")}>구성 확인</Button>
        </div>
      </div> : null}
      {step === "review" ? <div className={styles.setupBody}>
        <div className={styles.reviewPanel}>
          <span>선택한 템플릿</span><strong>{selectedTemplate.label}</strong>
          <span>생성할 컬렉션</span><strong>{previewSchema.collections.length}개</strong>
        </div>
        {previewSchema.collections.length > 0 ? <ul className={styles.collectionReview}>{previewSchema.collections.map((collection) => <li key={collection.id}>
          <strong>{collectionLabels[String(collection.id)] ?? defaultCollectionLabel(collection)}</strong>
          <span>{collection.name} · 필드 {collection.fields.length}개</span>
        </li>)}</ul> : <Callout tone="info">컬렉션 없는 빈 Schema revision을 생성합니다.</Callout>}
        <Callout tone="warning">적용 후에도 Schema 편집기에서 구조를 확장할 수 있습니다. setup에서는 안전한 초기 구성만 제공합니다.</Callout>
        {applyTemplate.isError ? <Callout tone="error">{toAdminApiError(applyTemplate.error).message}</Callout> : null}
        <div className={styles.setupActions}>
          <Button variant="secondary" onPress={() => setStep("customize")} isDisabled={applyTemplate.isPending}>이전</Button>
          <Button onPress={() => applyTemplate.mutate()} isDisabled={applyTemplate.isPending}>{applyTemplate.isPending ? "적용 중…" : "템플릿 적용하고 시작"}</Button>
        </div>
      </div> : null}
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
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      navigate(result.passwordChangeRequired === true
        ? "/admin/password-change"
        : status.data?.templateRequired ? "/admin/setup" : "/admin/schema", { replace: true });
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
  if (session.data?.user) return <Navigate to={session.data.passwordChangeRequired === true
    ? "/admin/password-change"
    : status.data?.templateRequired || session.data.schemaRevisionId === null ? "/admin/setup" : "/admin/schema"} replace />;
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

interface PasswordChangeValues {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly confirmation: string;
}

export function PasswordChangePage() {
  const api = useAdminApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { control, handleSubmit, watch } = useForm<PasswordChangeValues>({
    defaultValues: { currentPassword: "", newPassword: "", confirmation: "" },
  });
  const mutation = useMutation({
    mutationFn: ({ currentPassword, newPassword }: PasswordChangeValues) =>
      api.auth.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      queryClient.clear();
      navigate("/admin/login", { replace: true });
    },
  });
  return (
    <AuthLayout title="임시 비밀번호 변경" description="Admin 작업을 계속하려면 본인만 아는 새 비밀번호로 변경하세요.">
      {mutation.isError ? <Callout tone="error">{toAdminApiError(mutation.error).message}</Callout> : null}
      <form aria-label="임시 비밀번호 변경" className={styles.form} onSubmit={handleSubmit((values) => mutation.mutate(values))}>
        <Controller control={control} name="currentPassword" rules={{ required: "현재 비밀번호를 입력해 주세요." }} render={({ field: { ref, ...field }, fieldState }) => (
          <TextInput inputRef={ref} label="현재 임시 비밀번호" type="password" autoComplete="current-password" isRequired errorMessage={fieldState.error?.message} {...field} />
        )} />
        <Controller control={control} name="newPassword" rules={{ required: "새 비밀번호를 입력해 주세요.", minLength: { value: 12, message: "12자 이상이어야 합니다." }, maxLength: { value: 128, message: "128자 이하여야 합니다." } }} render={({ field: { ref, ...field }, fieldState }) => (
          <TextInput inputRef={ref} label="새 비밀번호" type="password" autoComplete="new-password" isRequired errorMessage={fieldState.error?.message} {...field} />
        )} />
        <Controller control={control} name="confirmation" rules={{ required: "새 비밀번호를 다시 입력해 주세요.", validate: (value) => value === watch("newPassword") || "비밀번호가 일치하지 않습니다." }} render={({ field: { ref, ...field }, fieldState }) => (
          <TextInput inputRef={ref} label="새 비밀번호 확인" type="password" autoComplete="new-password" isRequired errorMessage={fieldState.error?.message} {...field} />
        )} />
        <Button type="submit" isDisabled={mutation.isPending}>{mutation.isPending ? "변경 중…" : "비밀번호 변경"}</Button>
      </form>
    </AuthLayout>
  );
}
