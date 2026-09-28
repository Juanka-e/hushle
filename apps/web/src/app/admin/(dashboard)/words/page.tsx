"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    BookOpen,
    FileUp,
    Loader2,
    Pencil,
    Plus,
    Search,
    Trash2,
    X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { AdminSelectionBar } from "@/components/admin/admin-selection-bar";
import { AdminTableShell, AdminEmptyState } from "@/components/admin/admin-table-shell";
import { AdminToolbar, AdminToolbarStats } from "@/components/admin/admin-toolbar";
import { useAdminSelection } from "@/hooks/use-admin-selection";
import {
    describeBulkCategoryAssignment,
    resolveWordCategoryToggle,
} from "@/lib/words/category-selection-ui";
import {
    DEFAULT_GAME_CONTENT_LOCALE,
    GAME_CONTENT_LOCALES,
    GAME_CONTENT_LOCALE_DEFINITIONS,
    type GameContentLocale,
} from "@hushle/domain-game";

interface TabooWord {
    id: number;
    tabooWordText: string;
}

interface WordCategoryJoin {
    category: { id: number; name: string; color: string | null };
}

interface Word {
    id: number;
    wordText: string;
    difficulty: number;
    locale: GameContentLocale;
    tabooWords: TabooWord[];
    wordCategories: WordCategoryJoin[];
}

interface CategoryOption {
    id: number;
    name: string;
    color: string | null;
    children?: Array<{ id: number; name: string }>;
}

interface WordListResponse {
    words: Word[];
    total: number;
    page: number;
    pages: number;
    analyticsDays: number;
    analyticsByWordId: Record<number, WordAnalyticsSummary>;
}

interface WordAnalyticsSummary {
    shown: number;
    dogru: number;
    tabu: number;
    pas: number;
    timeout: number;
    exposureSeconds: number;
}

type DifficultyValue = "1" | "2" | "3";
type BulkUploadMode = "fixed_categories" | "csv_categories";

interface BulkUploadReport {
    success: number;
    skipped: number;
    errors: string[];
    skippedRows: string[];
}

const difficultyLabel: Record<number, string> = {
    1: "Kolay",
    2: "Orta",
    3: "Zor",
};

const difficultyColor: Record<number, string> = {
    1: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    2: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    3: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

function buildEmptyTabooFields(): string[] {
    return ["", "", "", "", ""];
}

function WordPerformance({
    summary,
    days,
}: {
    summary: WordAnalyticsSummary | undefined;
    days: number;
}) {
    if (!summary || summary.shown === 0) {
        return <span className="text-xs text-muted-foreground">Veri yok</span>;
    }

    const successRate = Math.round((summary.dogru / summary.shown) * 100);
    const averageSeconds = Math.round(summary.exposureSeconds / summary.shown);
    return (
        <div className="min-w-[150px] space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <span>%{successRate} doğru</span>
                <span className="text-muted-foreground">Ort. {averageSeconds} sn</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
                {summary.shown} kart · {summary.pas} pas · {summary.tabu} tabu · {summary.timeout} süre
            </div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                <span>Son {days} gün</span>
                {summary.shown < 10 ? (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        Düşük örnek
                    </span>
                ) : null}
            </div>
        </div>
    );
}

export default function AdminWordsPage() {
    const [words, setWords] = useState<Word[]>([]);
    const [selectedLocale, setSelectedLocale] = useState<GameContentLocale>(
        DEFAULT_GAME_CONTENT_LOCALE
    );
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [search, setSearch] = useState("");
    const [filterDifficulty, setFilterDifficulty] = useState<"" | DifficultyValue>("");
    const [filterCategoryId, setFilterCategoryId] = useState("");
    const [loading, setLoading] = useState(true);
    const [analyticsDays, setAnalyticsDays] = useState<7 | 30>(7);
    const [analyticsByWordId, setAnalyticsByWordId] = useState<Record<number, WordAnalyticsSummary>>({});

    const [categories, setCategories] = useState<CategoryOption[]>([]);
    const [categoriesLoading, setCategoriesLoading] = useState(true);

    const [formOpen, setFormOpen] = useState(false);
    const [editingWord, setEditingWord] = useState<Word | null>(null);
    const [formWord, setFormWord] = useState("");
    const [formDifficulty, setFormDifficulty] = useState<number>(1);
    const [formTabooWords, setFormTabooWords] = useState<string[]>(buildEmptyTabooFields);
    const [formCategoryIds, setFormCategoryIds] = useState<number[]>([]);
    const [formSaving, setFormSaving] = useState(false);
    const [formError, setFormError] = useState("");
    const [formHelperText, setFormHelperText] = useState("");
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [bulkDeleting, setBulkDeleting] = useState(false);
    const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
    const [bulkDeleteReason, setBulkDeleteReason] = useState("");
    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkFile, setBulkFile] = useState<File | null>(null);
    const [bulkMode, setBulkMode] = useState<BulkUploadMode>("csv_categories");
    const [bulkCategoryId, setBulkCategoryId] = useState("");
    const [bulkSubcategoryId, setBulkSubcategoryId] = useState("");
    const [bulkSaving, setBulkSaving] = useState(false);
    const [bulkError, setBulkError] = useState("");
    const [bulkReport, setBulkReport] = useState<BulkUploadReport | null>(null);

    const rootCategories = useMemo(() => categories, [categories]);
    const selectedSubcategories = useMemo(() => {
        const selected = categories.find((category) => String(category.id) === bulkCategoryId);
        return selected?.children ?? [];
    }, [bulkCategoryId, categories]);

    const flatCategories = useMemo(() => {
        const result: Array<{ id: number; name: string; indent: boolean }> = [];
        for (const category of categories) {
            result.push({ id: category.id, name: category.name, indent: false });
            for (const child of category.children ?? []) {
                result.push({ id: child.id, name: child.name, indent: true });
            }
        }
        return result;
    }, [categories]);

    const categorySelectionWarning = useMemo(() => {
        if (formCategoryIds.length === 0) {
            return "";
        }

        const categoryById = new Map<number, CategoryOption>();
        for (const category of categories) {
            categoryById.set(category.id, category);
            for (const child of category.children ?? []) {
                categoryById.set(child.id, {
                    id: child.id,
                    name: child.name,
                    color: null,
                });
            }
        }

        for (const category of categories) {
            const childIds = new Set((category.children ?? []).map((child) => child.id));
            if (!formCategoryIds.includes(category.id)) {
                continue;
            }

            const selectedChild = formCategoryIds.find((categoryId) => childIds.has(categoryId));
            if (!selectedChild) {
                continue;
            }

            const childName = categoryById.get(selectedChild)?.name ?? "Alt kategori";
            return `"${category.name}" ve "${childName}" birlikte secili. Aynı kelimeyi hem ana kategoriye hem alt kategorisine baglama.`;
        }

        return "";
    }, [categories, formCategoryIds]);

    const bulkAssignmentSummary = useMemo(
        () => describeBulkCategoryAssignment(bulkCategoryId, bulkSubcategoryId, categories),
        [bulkCategoryId, bulkSubcategoryId, categories]
    );

    const fetchWords = useCallback(async () => {
        setLoading(true);
        const params = new URLSearchParams({
            page: String(page),
            limit: "15",
            locale: selectedLocale,
        });
        if (search.trim()) {
            params.set("search", search.trim());
        }
        if (filterDifficulty) {
            params.set("difficulty", filterDifficulty);
        }
        if (filterCategoryId) {
            params.set("categoryId", filterCategoryId);
        }
        params.set("analyticsDays", String(analyticsDays));

        try {
            const response = await fetch(`/api/admin/words?${params.toString()}`, {
                cache: "no-store",
            });
            if (!response.ok) {
                toast.error("Kelime listesi yuklenemedi.");
                return;
            }

            const payload = (await response.json()) as WordListResponse;
            setWords(payload.words);
            setTotal(payload.total);
            setPages(payload.pages);
            setPage(payload.page);
            setAnalyticsByWordId(payload.analyticsByWordId);
        } catch {
            toast.error("Kelime listesi yuklenemedi.");
        } finally {
            setLoading(false);
        }
    }, [analyticsDays, filterCategoryId, filterDifficulty, page, search, selectedLocale]);

    const fetchCategories = useCallback(async () => {
        setCategoriesLoading(true);
        try {
            const response = await fetch(`/api/admin/categories?locale=${selectedLocale}`, { cache: "no-store" });
            if (!response.ok) {
                return;
            }
            const payload = (await response.json()) as CategoryOption[];
            setCategories(payload);
        } catch {
            // Keep the last successful category list.
        } finally {
            setCategoriesLoading(false);
        }
    }, [selectedLocale]);

    useEffect(() => {
        void fetchWords();
    }, [fetchWords]);

    const visibleWordIds = useMemo(() => words.map((word) => word.id), [words]);
    const {
        allSelected,
        clearSelection,
        selectedCount,
        selectedIds,
        toggleAll,
        toggleOne,
    } = useAdminSelection(visibleWordIds);

    useEffect(() => {
        void fetchCategories();
    }, [fetchCategories]);

    const resetForm = useCallback(() => {
        setEditingWord(null);
        setFormWord("");
        setFormDifficulty(1);
        setFormTabooWords(buildEmptyTabooFields());
        setFormCategoryIds([]);
        setFormError("");
        setFormHelperText("");
    }, []);

    const openCreate = useCallback(() => {
        resetForm();
        setFormOpen(true);
    }, [resetForm]);

    const openEdit = useCallback((word: Word) => {
        setEditingWord(word);
        setFormWord(word.wordText);
        setFormDifficulty(word.difficulty);
        const tabooWords = [...word.tabooWords.map((item) => item.tabooWordText)];
        while (tabooWords.length < 5) {
            tabooWords.push("");
        }
        setFormTabooWords(tabooWords);
        setFormCategoryIds(word.wordCategories.map((entry) => entry.category.id));
        setFormError("");
        setFormHelperText("");
        setFormOpen(true);
    }, []);

    const updateTabooWord = useCallback((index: number, value: string) => {
        setFormTabooWords((current) => {
            const next = [...current];
            next[index] = value;
            return next;
        });
    }, []);

    const toggleCategory = useCallback((categoryId: number) => {
        setFormCategoryIds((current) => {
            const result = resolveWordCategoryToggle(current, categoryId, categories);
            setFormHelperText(result.helperText);
            return result.nextSelection;
        });
    }, [categories]);

    const handleSave = useCallback(async () => {
        const cleanedTaboos = formTabooWords
            .map((value) => value.trim())
            .filter((value) => value.length > 0);

        if (!formWord.trim()) {
            setFormError("Kelime bos olamaz.");
            return;
        }

        if (cleanedTaboos.length === 0) {
            setFormError("En az bir yasakli kelime gerekli.");
            return;
        }

        if (categorySelectionWarning) {
            setFormError("Ana kategori ve onun alt kategorisi ayni kelimede birlikte tutulamaz.");
            return;
        }

        setFormSaving(true);
        setFormError("");

        try {
            const response = await fetch(
                editingWord ? `/api/admin/words/${editingWord.id}` : "/api/admin/words",
                {
                    method: editingWord ? "PUT" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        wordText: formWord.trim(),
                        difficulty: formDifficulty,
                        tabooWords: cleanedTaboos,
                        categoryIds: formCategoryIds,
                        locale: selectedLocale,
                    }),
                }
            );

            if (!response.ok) {
                const errorPayload = (await response.json().catch(() => ({
                    error: "Kelime kaydedilemedi.",
                }))) as { error?: string };
                setFormError(errorPayload.error ?? "Kelime kaydedilemedi.");
                return;
            }

            setFormOpen(false);
            resetForm();
            toast.success(editingWord ? "Kelime guncellendi." : "Kelime olusturuldu.");
            await fetchWords();
        } catch {
            setFormError("Ag hatasi olustu.");
        } finally {
            setFormSaving(false);
        }
    }, [
        categorySelectionWarning,
        editingWord,
        fetchWords,
        formCategoryIds,
        formDifficulty,
        formTabooWords,
        formWord,
        resetForm,
        selectedLocale,
    ]);

    const handleDelete = useCallback(async (word: Word) => {
        if (!window.confirm(`"${word.wordText}" kaydini silmek istediginize emin misiniz?`)) {
            return;
        }

        setDeletingId(word.id);
        try {
            const response = await fetch(`/api/admin/words/${word.id}`, {
                method: "DELETE",
            });
            if (!response.ok) {
                toast.error("Kelime silinemedi.");
                return;
            }

            toast.success("Kelime silindi.");
            await fetchWords();
        } catch {
            toast.error("Kelime silinemedi.");
        } finally {
            setDeletingId(null);
        }
    }, [fetchWords]);

    const activeFilterCount = Number(Boolean(search.trim()))
        + Number(Boolean(filterDifficulty))
        + Number(Boolean(filterCategoryId));

    useEffect(() => {
        clearSelection();
    }, [clearSelection, words]);

    const bulkDeleteCount = selectedCount;
    const bulkDeleteRequiresReason = bulkDeleteCount >= 10;

    const handleBulkDelete = useCallback(async () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) {
            return;
        }

        setBulkDeleting(true);
        try {
            const response = await fetch("/api/admin/words/bulk-delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids, reason: bulkDeleteReason.trim() }),
            });

            if (!response.ok) {
                const payload = (await response.json().catch(() => null)) as { error?: string } | null;
                toast.error(payload?.error ?? "Secili kelimeler silinemedi.");
                return;
            }

            const payload = (await response.json().catch(() => null)) as { deletedCount?: number } | null;
            toast.success(`${payload?.deletedCount ?? ids.length} kelime silindi.`);
            clearSelection();
            setBulkDeleteOpen(false);
            setBulkDeleteReason("");
            await fetchWords();
        } catch {
            toast.error("Secili kelimeler silinemedi.");
        } finally {
            setBulkDeleting(false);
        }
    }, [bulkDeleteReason, clearSelection, fetchWords, selectedIds]);

    return (
        <div className="space-y-6">
            <AdminPageHeader
                title="Kelime Yonetimi"
                description="Kelime havuzunu arama, filtreleme ve hizli duzenleme akislariyla yonetin."
                meta={`${total} kayit`}
                icon={<BookOpen className="h-5 w-5 text-sky-500" />}
                action={
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={selectedLocale}
                            onChange={(event) => {
                                setSelectedLocale(event.target.value as GameContentLocale);
                                setPage(1);
                                setFilterCategoryId("");
                                setFormCategoryIds([]);
                            }}
                            className="h-10 rounded-xl border border-border bg-background px-3 text-sm font-bold"
                            aria-label="Kelime paketi dili"
                        >
                            {GAME_CONTENT_LOCALES.map((locale) => (
                                <option key={locale} value={locale}>
                                    {GAME_CONTENT_LOCALE_DEFINITIONS[locale].adminLabel}
                                </option>
                            ))}
                        </select>
                        <Button variant="outline" onClick={() => setBulkOpen(true)} className="gap-2">
                            <FileUp size={16} />
                            Toplu Yukle
                        </Button>
                        <Button onClick={openCreate} className="gap-2">
                            <Plus size={16} />
                            Yeni Kelime
                        </Button>
                    </div>
                }
            />

            <AdminToolbar>
                <div className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_160px_150px_220px]">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(event) => {
                                setSearch(event.target.value);
                                setPage(1);
                            }}
                            placeholder="Kelime ara..."
                            className="pl-9"
                        />
                    </div>
                    <select
                        value={filterDifficulty}
                        onChange={(event) => {
                            const value = event.target.value as "" | DifficultyValue;
                            setFilterDifficulty(value);
                            setPage(1);
                        }}
                        className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none"
                    >
                        <option value="">Tum zorluklar</option>
                        <option value="1">Kolay</option>
                        <option value="2">Orta</option>
                        <option value="3">Zor</option>
                    </select>
                    <select
                        value={analyticsDays}
                        onChange={(event) => setAnalyticsDays(Number(event.target.value) as 7 | 30)}
                        className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none"
                        aria-label="Kelime performans araligi"
                    >
                        <option value={7}>Son 7 gün</option>
                        <option value={30}>Son 30 gün</option>
                    </select>
                    <select
                        value={filterCategoryId}
                        onChange={(event) => {
                            setFilterCategoryId(event.target.value);
                            setPage(1);
                        }}
                        className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none"
                        disabled={categoriesLoading}
                    >
                        <option value="">Tum kategoriler</option>
                        {flatCategories.map((category) => (
                            <option key={category.id} value={String(category.id)}>
                                {category.indent ? `- ${category.name}` : category.name}
                            </option>
                        ))}
                    </select>
                </div>
                <AdminToolbarStats
                    stats={[
                        { label: "sayfa", value: `${page} / ${pages}` },
                        { label: "filtre", value: String(activeFilterCount) },
                    ]}
                />
            </AdminToolbar>

            <AdminSelectionBar selectedCount={selectedCount} onClear={clearSelection}>
                <span className="text-xs text-muted-foreground">
                    Yalnız bu sayfadaki görünen kayıtlar seçilir.
                </span>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={bulkDeleting}
                    onClick={() => setBulkDeleteOpen(true)}
                    className="gap-2"
                >
                    {bulkDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    Seçilileri Sil
                </Button>
            </AdminSelectionBar>

            <AdminTableShell
                title="Kelime Kayitlari"
                description="Liste server-side filtrelenir. Performans verisi karar desteğidir; kelimeler otomatik değiştirilmez veya gizlenmez."
                loading={loading}
                isEmpty={!loading && words.length === 0}
                emptyState={
                    <AdminEmptyState
                        icon={<BookOpen className="h-6 w-6" />}
                        title="Kelime bulunamadi"
                        description="Arama veya filtre sonucunda gosterilecek kayit yok."
                    />
                }
                footer={
                    <AdminPagination
                        page={page}
                        pageCount={pages}
                        onPageChange={setPage}
                    />
                }
            >
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/20">
                            <TableHead className="w-10 text-center">
                                <input
                                    type="checkbox"
                                    checked={allSelected}
                                    onChange={() => toggleAll()}
                                    aria-label="Tum gorunen kelimeleri sec"
                                    className="h-4 w-4 rounded border-border"
                                />
                            </TableHead>
                            <TableHead>Kelime</TableHead>
                            <TableHead>Zorluk</TableHead>
                            <TableHead>Yasakli Kelimeler</TableHead>
                            <TableHead>Kategoriler</TableHead>
                            <TableHead>Performans</TableHead>
                            <TableHead className="text-right">Islem</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {words.map((word) => (
                            <TableRow key={word.id}>
                                <TableCell className="text-center">
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(word.id)}
                                        onChange={() => toggleOne(word.id)}
                                        aria-label={`${word.wordText} sec`}
                                        className="h-4 w-4 rounded border-border"
                                    />
                                </TableCell>
                                <TableCell className="font-semibold text-foreground">
                                    {word.wordText}
                                </TableCell>
                                <TableCell>
                                    <span
                                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${difficultyColor[word.difficulty]}`}
                                    >
                                        {difficultyLabel[word.difficulty]}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap gap-1.5">
                                        {word.tabooWords.map((taboo) => (
                                            <span
                                                key={taboo.id}
                                                className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/20 dark:text-red-400"
                                            >
                                                {taboo.tabooWordText}
                                            </span>
                                        ))}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap gap-1.5">
                                        {word.wordCategories.map(({ category }) => (
                                            <span
                                                key={category.id}
                                                className="rounded-full px-2 py-0.5 text-xs font-medium"
                                                style={{
                                                    backgroundColor: category.color
                                                        ? `${category.color}20`
                                                        : undefined,
                                                    color: category.color ?? undefined,
                                                }}
                                            >
                                                {category.name}
                                            </span>
                                        ))}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <WordPerformance
                                        summary={analyticsByWordId[word.id]}
                                        days={analyticsDays}
                                    />
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => openEdit(word)}
                                        >
                                            <Pencil size={15} />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => void handleDelete(word)}
                                            disabled={deletingId === word.id}
                                        >
                                            {deletingId === word.id ? (
                                                <Loader2 size={15} className="animate-spin" />
                                            ) : (
                                                <Trash2 size={15} />
                                            )}
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </AdminTableShell>

            {formOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
                    <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-border bg-card shadow-2xl">
                        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
                            <div>
                                <h2 className="text-lg font-semibold text-foreground">
                                    {editingWord ? "Kelime duzenle" : "Yeni kelime"}
                                </h2>
                                <p className="text-sm text-muted-foreground">
                                    Kelime, zorluk, yasakli kelime ve kategori alanlarini tek formda yonet.
                                </p>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                    setFormOpen(false);
                                    resetForm();
                                }}
                            >
                                <X size={18} />
                            </Button>
                        </div>

                        <div className="space-y-5 p-5">
                            {formError ? (
                                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400">
                                    {formError}
                                </div>
                            ) : null}

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                    Ana kelime
                                </label>
                                <Input
                                    value={formWord}
                                    onChange={(event) => setFormWord(event.target.value)}
                                    placeholder="Kelimeyi yazin..."
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                    Zorluk
                                </label>
                                <div className="grid gap-2 md:grid-cols-3">
                                    {[1, 2, 3].map((difficulty) => (
                                        <button
                                            key={difficulty}
                                            type="button"
                                            onClick={() => setFormDifficulty(difficulty)}
                                            className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                                                formDifficulty === difficulty
                                                    ? "border-sky-500 bg-sky-500/10 text-foreground"
                                                    : "border-border bg-background text-muted-foreground hover:border-sky-300"
                                            }`}
                                        >
                                            {difficultyLabel[difficulty]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                        Yasakli kelimeler
                                    </label>
                                    {formTabooWords.length < 10 ? (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                setFormTabooWords((current) => [...current, ""])
                                            }
                                        >
                                            Alan ekle
                                        </Button>
                                    ) : null}
                                </div>
                                <div className="grid gap-2">
                                    {formTabooWords.map((tabooWord, index) => (
                                        <div key={`taboo-${index}`} className="flex gap-2">
                                            <Input
                                                value={tabooWord}
                                                onChange={(event) =>
                                                    updateTabooWord(index, event.target.value)
                                                }
                                                placeholder={`Yasakli kelime ${index + 1}`}
                                            />
                                            {formTabooWords.length > 1 ? (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon"
                                                    onClick={() =>
                                                        setFormTabooWords((current) =>
                                                            current.filter((_, itemIndex) => itemIndex !== index)
                                                        )
                                                    }
                                                >
                                                    <X size={14} />
                                                </Button>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                    Kategoriler
                                </label>
                                <div className="grid max-h-52 gap-2 overflow-y-auto rounded-2xl border border-border bg-muted/20 p-3 md:grid-cols-2">
                                    {flatCategories.map((category) => (
                                        <label
                                            key={category.id}
                                            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                                                category.indent
                                                    ? "pl-6 text-muted-foreground"
                                                    : "font-medium text-foreground"
                                            } hover:bg-background/70`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={formCategoryIds.includes(category.id)}
                                                onChange={() => toggleCategory(category.id)}
                                                className="h-4 w-4 rounded border-border"
                                            />
                                            <span>{category.name}</span>
                                        </label>
                                    ))}
                                </div>
                                <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                                    <p>
                                        Ana kategori satiri genel havuzu temsil eder. Alt kategori satiri ise yalniz kendi alt havuzunu temsil eder.
                                    </p>
                                    <p>
                                        UI parent + child secimini ayni anda tutmaz; alt kategori secersen parent otomatik kaldirilir.
                                    </p>
                                    {formHelperText ? (
                                        <p className="font-semibold text-sky-700 dark:text-sky-300">
                                            {formHelperText}
                                        </p>
                                    ) : null}
                                    {categorySelectionWarning ? (
                                        <p className="font-semibold text-amber-600 dark:text-amber-300">
                                            {categorySelectionWarning}
                                        </p>
                                    ) : null}
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    setFormOpen(false);
                                    resetForm();
                                }}
                            >
                                Iptal
                            </Button>
                            <Button
                                type="button"
                                onClick={() => void handleSave()}
                                disabled={formSaving}
                                className="gap-2"
                            >
                                {formSaving ? <Loader2 size={16} className="animate-spin" /> : null}
                                {editingWord ? "Guncelle" : "Kaydet"}
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}

            {bulkOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-2xl rounded-3xl border border-border bg-card shadow-2xl">
                        <div className="flex items-center justify-between border-b border-border px-5 py-4">
                            <div>
                                <h2 className="text-lg font-semibold text-foreground">Toplu kelime yükle</h2>
                                <p className="text-sm text-muted-foreground">
                                    CSV dosyasını yükle. İstersen her satır kendi kategori bilgisini taşısın, istersen tüm satırlara ortak kategori uygula.
                                </p>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                    setBulkOpen(false);
                                    setBulkFile(null);
                                    setBulkMode("csv_categories");
                                    setBulkCategoryId("");
                                    setBulkSubcategoryId("");
                                    setBulkError("");
                                    setBulkReport(null);
                                }}
                            >
                                <X size={18} />
                            </Button>
                        </div>

                        <div className="space-y-5 p-5">
                            {bulkError ? (
                                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400">
                                    {bulkError}
                                </div>
                            ) : null}

                            <div className="rounded-2xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        variant={bulkMode === "csv_categories" ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => {
                                            setBulkMode("csv_categories");
                                            setBulkCategoryId("");
                                            setBulkSubcategoryId("");
                                            setBulkReport(null);
                                        }}
                                    >
                                        CSV Kategorisi
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={bulkMode === "fixed_categories" ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => {
                                            setBulkMode("fixed_categories");
                                            setBulkReport(null);
                                        }}
                                    >
                                        Ortak Kategori Ata
                                    </Button>
                                </div>
                                <div className="mt-3 rounded-xl bg-background px-3 py-2 font-mono text-xs text-foreground">
                                    {bulkMode === "csv_categories"
                                        ? "kelime,zorluk,kategori,alt_kategori,yasak1,yasak2,yasak3,yasak4,yasak5"
                                        : "kelime,zorluk,yasak1,yasak2,yasak3,yasak4,yasak5"}
                                </div>
                                <p className="mt-2">
                                    {bulkMode === "csv_categories"
                                        ? "Farkli kategorilerde cok sayida kelime yuklemek icin kategori ve alt kategori adlarini CSV icinde ver."
                                        : "Tum satirlara ayni kategori veya alt kategori atanacaksa bu modu kullan."}
                                </p>
                                <p className="mt-2 text-xs">
                                    {bulkMode === "csv_categories"
                                        ? "Alt kategori yoksa alt_kategori sutununu bos birak. Alt kategori verilirse kelime yalniz alt kategoriye baglanir."
                                        : "Bu modda CSV icinden kategori okunmaz. Alt kategori secersen kelime parent + child yerine yalniz alt kategoriye yazilir."}
                                </p>
                                {bulkAssignmentSummary ? (
                                    <p className="mt-2 rounded-xl border border-border/70 bg-card px-3 py-2 text-xs font-medium text-sky-700 dark:text-sky-300">
                                        {bulkAssignmentSummary}
                                    </p>
                                ) : null}
                                <p className="mt-2 text-xs">
                                    Kategori taksonomisi bulk upload sırasında otomatik açılmaz. Yeni kategori gerekiyorsa önce kategori yönetiminden oluştur.
                                </p>
                                <div className="mt-3 rounded-xl border border-border/70 bg-card px-3 py-3 text-xs text-muted-foreground">
                                    <p className="font-semibold text-foreground">Örnek</p>
                                    <div className="mt-2 space-y-1 font-mono">
                                        {bulkMode === "csv_categories" ? (
                                            <>
                                                <div>marti,1,Hayvanlar,,kanat,deniz,ucmak</div>
                                                <div>levrek,2,Yiyecek,Deniz Urunleri,balik,izgara,kilcik</div>
                                            </>
                                        ) : (
                                            <div>marti,1,kanat,deniz,ucmak</div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                    CSV dosyasi
                                </label>
                                <Input
                                    type="file"
                                    accept=".csv,text/csv"
                                    onChange={(event) => setBulkFile(event.target.files?.[0] ?? null)}
                                />
                            </div>

                            <div className={`grid gap-4 md:grid-cols-2 ${bulkMode !== "fixed_categories" ? "opacity-60" : ""}`}>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                        Kategori
                                    </label>
                                    <select
                                        value={bulkCategoryId}
                                        onChange={(event) => {
                                            setBulkCategoryId(event.target.value);
                                            setBulkSubcategoryId("");
                                        }}
                                        disabled={bulkMode !== "fixed_categories"}
                                        className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none"
                                    >
                                        <option value="">Kategori atama</option>
                                        {rootCategories.map((category) => (
                                            <option key={category.id} value={String(category.id)}>
                                                {category.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                        Alt kategori
                                    </label>
                                    <select
                                        value={bulkSubcategoryId}
                                        onChange={(event) => setBulkSubcategoryId(event.target.value)}
                                        disabled={
                                            bulkMode !== "fixed_categories"
                                            || !bulkCategoryId
                                            || selectedSubcategories.length === 0
                                        }
                                        className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <option value="">Alt kategori atama</option>
                                        {selectedSubcategories.map((category) => (
                                            <option key={category.id} value={String(category.id)}>
                                                {category.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {bulkReport ? (
                                <div className="rounded-2xl border border-border bg-muted/20 p-4">
                                    <div className="grid gap-3 md:grid-cols-3">
                                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-3">
                                            <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                                                Eklendi
                                            </div>
                                            <div className="mt-1 text-2xl font-black text-foreground">{bulkReport.success}</div>
                                        </div>
                                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-3">
                                            <div className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
                                                Atlandı
                                            </div>
                                            <div className="mt-1 text-2xl font-black text-foreground">{bulkReport.skipped}</div>
                                        </div>
                                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-3">
                                            <div className="text-xs font-bold uppercase tracking-[0.18em] text-red-700 dark:text-red-300">
                                                Hata
                                            </div>
                                            <div className="mt-1 text-2xl font-black text-foreground">{bulkReport.errors.length}</div>
                                        </div>
                                    </div>

                                    {bulkReport.skippedRows.length > 0 ? (
                                        <div className="mt-4">
                                            <h3 className="text-sm font-semibold text-foreground">Atlanan satırlar</h3>
                                            <div className="mt-2 max-h-32 overflow-y-auto rounded-xl border border-border bg-background px-3 py-3 text-sm text-muted-foreground">
                                                <ul className="space-y-1">
                                                    {bulkReport.skippedRows.map((item) => (
                                                        <li key={item}>{item}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                    ) : null}

                                    {bulkReport.errors.length > 0 ? (
                                        <div className="mt-4">
                                            <h3 className="text-sm font-semibold text-foreground">Hatalı satırlar</h3>
                                            <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-red-500/20 bg-background px-3 py-3 text-sm text-red-600 dark:text-red-300">
                                                <ul className="space-y-1">
                                                    {bulkReport.errors.map((item) => (
                                                        <li key={item}>{item}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>

                        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    setBulkOpen(false);
                                    setBulkFile(null);
                                    setBulkMode("csv_categories");
                                    setBulkCategoryId("");
                                    setBulkSubcategoryId("");
                                    setBulkError("");
                                    setBulkReport(null);
                                }}
                            >
                                İptal
                            </Button>
                            <Button
                                type="button"
                                onClick={async () => {
                                    if (!bulkFile) {
                                        setBulkError("Önce bir CSV dosyası seç.");
                                        return;
                                    }

                                    setBulkSaving(true);
                                    setBulkError("");
                                    setBulkReport(null);

                                    try {
                                        const formData = new FormData();
                                        formData.append("file", bulkFile);
                                        formData.append("mode", bulkMode);
                                        formData.append("locale", selectedLocale);
                                        if (bulkMode === "fixed_categories" && bulkCategoryId) {
                                            formData.append("categoryId", bulkCategoryId);
                                        }
                                        if (bulkMode === "fixed_categories" && bulkSubcategoryId) {
                                            formData.append("subcategoryId", bulkSubcategoryId);
                                        }

                                        const response = await fetch("/api/admin/words/bulk-upload", {
                                            method: "POST",
                                            body: formData,
                                        });
                                        const payload = await response.json().catch(() => null) as
                                            | {
                                                error?: string;
                                                success?: number;
                                                skipped?: number;
                                                errors?: string[];
                                                skippedRows?: string[];
                                            }
                                            | null;

                                        if (!response.ok) {
                                            setBulkError(payload?.error ?? "Toplu yükleme başarısız oldu.");
                                            return;
                                        }

                                        const errorCount = payload?.errors?.length ?? 0;
                                        const skippedCount = payload?.skipped ?? 0;
                                        const nextReport: BulkUploadReport = {
                                            success: payload?.success ?? 0,
                                            skipped: skippedCount,
                                            errors: payload?.errors ?? [],
                                            skippedRows: payload?.skippedRows ?? [],
                                        };
                                        toast.success(
                                            `${nextReport.success} kelime eklendi, ${skippedCount} kayıt atlandı${errorCount ? `, ${errorCount} hata var` : ""}.`
                                        );
                                        await fetchWords();
                                        if (nextReport.errors.length > 0 || nextReport.skippedRows.length > 0) {
                                            setBulkReport(nextReport);
                                            return;
                                        }

                                        setBulkOpen(false);
                                        setBulkFile(null);
                                        setBulkMode("csv_categories");
                                        setBulkCategoryId("");
                                        setBulkSubcategoryId("");
                                        setBulkError("");
                                        setBulkReport(null);
                                    } catch {
                                        setBulkError("Ağ hatası oluştu.");
                                    } finally {
                                        setBulkSaving(false);
                                    }
                                }}
                                disabled={bulkSaving}
                                className="gap-2"
                            >
                                {bulkSaving ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
                                Yüklemeyi Başlat
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}

            {bulkDeleteOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-xl rounded-3xl border border-border bg-card shadow-2xl">
                        <div className="flex items-center justify-between border-b border-border px-5 py-4">
                            <div>
                                <h2 className="text-lg font-semibold text-foreground">Toplu silmeyi onayla</h2>
                                <p className="text-sm text-muted-foreground">
                                    Bu işlem geri alınamaz. Yalnız bu sayfadaki seçili kelimeler silinir.
                                </p>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                    setBulkDeleteOpen(false);
                                    setBulkDeleteReason("");
                                }}
                            >
                                <X size={18} />
                            </Button>
                        </div>

                        <div className="space-y-5 p-5">
                            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-4">
                                <div className="text-xs font-bold uppercase tracking-[0.18em] text-red-700 dark:text-red-300">
                                    Silinecek kayıt
                                </div>
                                <div className="mt-2 text-3xl font-black text-foreground">
                                    {bulkDeleteCount}
                                </div>
                                <div className="mt-1 text-sm text-muted-foreground">
                                    {bulkDeleteCount} kelimeyi sil
                                </div>
                            </div>

                            <div className="rounded-2xl border border-border bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
                                Bu onay penceresi yanlış toplu silmeleri engellemek için var. Büyük silmeler audit kaydına not ile düşer.
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                    Operasyon notu {bulkDeleteRequiresReason ? "(zorunlu)" : "(opsiyonel)"}
                                </label>
                                <textarea
                                    value={bulkDeleteReason}
                                    onChange={(event) => setBulkDeleteReason(event.target.value)}
                                    rows={4}
                                    placeholder={
                                        bulkDeleteRequiresReason
                                            ? "Ör: Hatalı import temizliği, duplicate kayıt silme, test verisi temizliği."
                                            : "İstersen kısa bir not ekle."
                                    }
                                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-red-500/40"
                                />
                                {bulkDeleteRequiresReason ? (
                                    <p className="text-xs text-amber-600 dark:text-amber-300">
                                        10 veya daha fazla kelime silerken açıklayıcı bir not zorunludur.
                                    </p>
                                ) : null}
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    setBulkDeleteOpen(false);
                                    setBulkDeleteReason("");
                                }}
                            >
                                İptal
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                disabled={bulkDeleting || (bulkDeleteRequiresReason && bulkDeleteReason.trim().length < 8)}
                                onClick={() => void handleBulkDelete()}
                            >
                                {bulkDeleting ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}
                                {bulkDeleteCount} kelimeyi sil
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}


