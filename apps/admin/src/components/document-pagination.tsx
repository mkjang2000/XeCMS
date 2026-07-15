import { Button } from "@xecms/ui";
import { calculateLastPage } from "@xecms/admin";
import styles from "../app.module.css";

export function DocumentPagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly onChange: (page: number) => void;
}) {
  if (total === 0) return null;
  const lastPage = calculateLastPage(total, pageSize);
  return (
    <div className={styles.pagination} role="group" aria-label="문서 페이지">
      <Button variant="secondary" isDisabled={page <= 1} onPress={() => onChange(page - 1)}>
        이전 페이지
      </Button>
      <span aria-live="polite">{page} / {lastPage} 페이지</span>
      <Button
        variant="secondary"
        isDisabled={page >= lastPage}
        onPress={() => onChange(page + 1)}
      >
        다음 페이지
      </Button>
    </div>
  );
}
