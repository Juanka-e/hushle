"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    FolderTree,
    Plus,
    Pencil,
    Trash2,
    Eye,
    EyeOff,
    X,
    Loader2,
    ChevronDown,
    ChevronUp,
    ChevronRight,
    Palette,
    GripVertical,
} from "lucide-react";
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import {
    DEFAULT_GAME_CONTENT_LOCALE,
    GAME_CONTENT_LOCALES,
    GAME_CONTENT_LOCALE_DEFINITIONS,
    type GameContentLocale,
} from "@hushle/domain-game";

interface Category {
    id: number;
    name: string;
    parentId: number | null;
    color: string | null;
    sortOrder: number;
    isVisible: boolean;
    locale: GameContentLocale;
    children: Category[];
    _count?: { wordCategories: number };
}

interface DeleteCandidate {
    id: number;
    name: string;
    parentId: number | null;
    childCount: number;
    wordCount: number;
}

interface SortableCategoryProps {
    category: Category;
    expanded: Set<number>;
    onCreateChild: (parentId: number) => void;
    onDelete: (category: DeleteCandidate) => void;
    onEdit: (category: Category) => void;
    onToggleExpand: (id: number) => void;
    onToggleVisibility: (category: Category) => void;
    onMove: (id: number, direction: "up" | "down") => void;
    position: number;
    total: number;
    reorderSaving: boolean;
}

function SortableCategory({
    category,
    expanded,
    onCreateChild,
    onDelete,
    onEdit,
    onToggleExpand,
    onToggleVisibility,
    onMove,
    position,
    total,
    reorderSaving,
}: SortableCategoryProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: category.id, disabled: reorderSaving });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const hasChildren = category.children.length > 0;
    const isExpanded = expanded.has(category.id);

    return (
        <div className="relative">
            <div
                ref={setNodeRef}
                style={style}
                data-testid={`category-row-${category.id}`}
                className={`flex flex-wrap items-center gap-2 px-3 py-3 transition-colors hover:bg-gray-50/60 sm:flex-nowrap sm:gap-3 sm:px-4 dark:hover:bg-slate-700/30 ${
                    !category.isVisible ? "opacity-50" : ""
                }`}
            >
                <button
                    {...attributes}
                    {...listeners}
                    disabled={reorderSaving}
                    className="flex h-11 w-11 shrink-0 touch-none cursor-grab items-center justify-center rounded-xl border border-transparent text-gray-400 transition active:cursor-grabbing hover:border-border hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    title="Sürükleyerek sırayı değiştir"
                    aria-label={`${category.name} kategorisini sürükleyerek sırala`}
                    data-testid={`category-drag-${category.id}`}
                >
                    <GripVertical size={18} />
                </button>

                <div
                    className="h-4 w-4 shrink-0 rounded-full border-2 border-white shadow-sm dark:border-slate-700"
                    style={{ backgroundColor: category.color || "#94a3b8" }}
                />

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-bold text-slate-800 dark:text-white">
                            {category.name}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                            Ana kategori
                        </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
                        <span>{category._count?.wordCategories ?? 0} kelime</span>
                        <span>{category.children.length} alt kategori</span>
                    </div>
                </div>

                <div className="order-3 ml-[3.25rem] flex w-full flex-wrap items-center justify-end gap-1 sm:order-none sm:ml-0 sm:w-auto sm:flex-nowrap">
                    <button
                        type="button"
                        onClick={() => onMove(category.id, "up")}
                        disabled={reorderSaving || position === 0}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-700 dark:hover:text-white"
                        title="Yukarı taşı"
                        aria-label={`${category.name} kategorisini yukarı taşı`}
                        data-testid={`category-up-${category.id}`}
                    >
                        <ChevronUp size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={() => onMove(category.id, "down")}
                        disabled={reorderSaving || position === total - 1}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-700 dark:hover:text-white"
                        title="Aşağı taşı"
                        aria-label={`${category.name} kategorisini aşağı taşı`}
                        data-testid={`category-down-${category.id}`}
                    >
                        <ChevronDown size={16} />
                    </button>
                    <button
                        onClick={() => onToggleVisibility(category)}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-900/20"
                        title={category.isVisible ? "Gizle" : "Görünür yap"}
                    >
                        {category.isVisible ? <Eye size={15} /> : <EyeOff size={15} />}
                    </button>
                    <button
                        onClick={() => onCreateChild(category.id)}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/20"
                        title="Alt kategori ekle"
                    >
                        <Plus size={15} />
                    </button>
                    <button
                        onClick={() => onEdit(category)}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20"
                        title="Düzenle"
                    >
                        <Pencil size={15} />
                    </button>
                    <button
                        onClick={() =>
                            onDelete({
                                id: category.id,
                                name: category.name,
                                parentId: category.parentId,
                                childCount: category.children.length,
                                wordCount: category._count?.wordCategories ?? 0,
                            })
                        }
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                        title="Sil"
                    >
                        <Trash2 size={15} />
                    </button>
                    {hasChildren ? (
                        <button
                            onClick={() => onToggleExpand(category.id)}
                            className="rounded p-1 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
                            title={isExpanded ? "Daralt" : "Genişlet"}
                        >
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                    ) : null}
                </div>
            </div>

            {hasChildren && isExpanded ? (
                <div className="ml-7 border-l-2 border-gray-100 dark:border-slate-700">
                    {category.children.map((child) => (
                        <div
                            key={child.id}
                            className={`flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50/50 sm:flex-nowrap dark:hover:bg-slate-700/30 ${
                                !child.isVisible ? "opacity-50" : ""
                            }`}
                        >
                            <div className="w-6" />
                            <div
                                className="h-4 w-4 shrink-0 rounded-full border-2 border-white shadow-sm dark:border-slate-700"
                                style={{ backgroundColor: child.color || "#94a3b8" }}
                            />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="truncate text-sm text-gray-700 dark:text-gray-300">
                                        {child.name}
                                    </span>
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                                        Alt kategori
                                    </span>
                                </div>
                                <div className="mt-1 text-xs text-slate-400">
                                    {child._count?.wordCategories ?? 0} kelime
                                </div>
                            </div>
                            <div className="ml-9 flex w-full items-center justify-end gap-1 sm:ml-0 sm:w-auto">
                                <button
                                    onClick={() => onToggleVisibility(child)}
                                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-900/20"
                                    title={child.isVisible ? "Gizle" : "Görünür yap"}
                                >
                                    {child.isVisible ? <Eye size={15} /> : <EyeOff size={15} />}
                                </button>
                                <button
                                    onClick={() => onEdit(child)}
                                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20"
                                    title="Düzenle"
                                >
                                    <Pencil size={15} />
                                </button>
                                <button
                                    onClick={() =>
                                        onDelete({
                                            id: child.id,
                                            name: child.name,
                                            parentId: child.parentId,
                                            childCount: 0,
                                            wordCount: child._count?.wordCategories ?? 0,
                                        })
                                    }
                                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                                    title="Sil"
                                >
                                    <Trash2 size={15} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

export default function AdminCategoriesPage() {
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedLocale, setSelectedLocale] = useState<GameContentLocale>(
        DEFAULT_GAME_CONTENT_LOCALE
    );
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(true);
    const [pageError, setPageError] = useState("");
    const [reorderSaving, setReorderSaving] = useState(false);

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<Category | null>(null);
    const [formName, setFormName] = useState("");
    const [formColor, setFormColor] = useState("#6366f1");
    const [formParentId, setFormParentId] = useState<number | null>(null);
    const [formVisible, setFormVisible] = useState(true);
    const [formSaving, setFormSaving] = useState(false);
    const [formError, setFormError] = useState("");
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleteCandidate, setDeleteCandidate] = useState<DeleteCandidate | null>(null);
    const [deleteTargetId, setDeleteTargetId] = useState("");
    const [deleteError, setDeleteError] = useState("");
    const [deleteSaving, setDeleteSaving] = useState(false);
    const reorderInFlightRef = useRef(false);

    const sensors = useSensors(
        useSensor(MouseSensor, {
            activationConstraint: {
                distance: 6,
            },
        }),
        useSensor(TouchSensor, {
            activationConstraint: {
                delay: 180,
                tolerance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const fetchCategories = useCallback(async (showLoading = true) => {
        if (showLoading) {
            setLoading(true);
        }
        try {
            const response = await fetch(`/api/admin/categories?locale=${selectedLocale}`, { cache: "no-store" });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                setPageError((payload as { error?: string } | null)?.error ?? "Kategori listesi yüklenemedi.");
                return;
            }

            const nextCategories = (payload ?? []) as Category[];
            setCategories(nextCategories);
            setExpanded(new Set(nextCategories.map((category) => category.id)));
            setPageError("");
        } catch {
            setPageError("Kategori listesi yüklenirken ağ hatası oluştu.");
        } finally {
            if (showLoading) {
                setLoading(false);
            }
        }
    }, [selectedLocale]);

    useEffect(() => {
        void fetchCategories();
    }, [fetchCategories]);

    const rootCategoryOptions = useMemo(
        () => categories.map((category) => ({ id: category.id, name: category.name })),
        [categories]
    );

    const currentParentLabel = useMemo(() => {
        if (formParentId === null) {
            return null;
        }

        return categories.find((category) => category.id === formParentId)?.name ?? null;
    }, [categories, formParentId]);

    const totalCategories = useMemo(
        () => categories.reduce((sum, category) => sum + 1 + category.children.length, 0),
        [categories]
    );

    const totalSubcategories = useMemo(
        () => categories.reduce((sum, category) => sum + category.children.length, 0),
        [categories]
    );

    const flatCategoryOptions = useMemo(
        () =>
            categories.flatMap((category) => {
                const rootOption = {
                    id: category.id,
                    name: category.name,
                    parentId: category.parentId,
                    label: `${category.name} (Ana kategori)`,
                };

                const childOptions = category.children.map((child) => ({
                    id: child.id,
                    name: child.name,
                    parentId: child.parentId,
                    label: `${category.name} / ${child.name}`,
                }));

                return [rootOption, ...childOptions];
            }),
        [categories]
    );

    const deleteTargetOptions = useMemo(() => {
        if (!deleteCandidate) {
            return [];
        }

        return flatCategoryOptions.filter((category) => {
            if (category.id === deleteCandidate.id) {
                return false;
            }

            if (deleteCandidate.parentId === null) {
                return category.parentId === null;
            }

            return true;
        });
    }, [deleteCandidate, flatCategoryOptions]);

    const deleteRequiresMove = Boolean(
        deleteCandidate && (deleteCandidate.wordCount > 0 || deleteCandidate.childCount > 0)
    );

    const openCreate = useCallback((parentId: number | null = null) => {
        setEditing(null);
        setFormName("");
        setFormColor("#6366f1");
        setFormParentId(parentId);
        setFormVisible(true);
        setFormError("");
        setPageError("");
        setFormOpen(true);
    }, []);

    const openEdit = useCallback((category: Category) => {
        setEditing(category);
        setFormName(category.name);
        setFormColor(category.color || "#6366f1");
        setFormParentId(category.parentId);
        setFormVisible(category.isVisible);
        setFormError("");
        setPageError("");
        setFormOpen(true);
    }, []);

    const persistRootOrder = useCallback(async (
        previousCategories: Category[],
        nextCategories: Category[]
    ) => {
        if (reorderInFlightRef.current) {
            return;
        }

        const normalizedCategories = nextCategories.map((category, index) => ({
            ...category,
            sortOrder: index * 10,
        }));
        const updates = normalizedCategories.map((category) => ({
            id: category.id,
            sortOrder: category.sortOrder,
        }));

        reorderInFlightRef.current = true;
        setCategories(normalizedCategories);
        setReorderSaving(true);
        setPageError("");

        try {
            const response = await fetch("/api/admin/categories/reorder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ locale: selectedLocale, updates }),
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => null) as { error?: string } | null;
                const message = payload?.error ?? "Kategori sırası kaydedilemedi.";
                setCategories(previousCategories);
                setPageError(message);
                toast.error(message);
                if (response.status === 422) {
                    await fetchCategories(false);
                }
                return;
            }

            setPageError("");
            toast.success("Kategori sırası kaydedildi.");
        } catch {
            const message = "Kategori sırası kaydedilirken ağ hatası oluştu.";
            setCategories(previousCategories);
            setPageError(message);
            toast.error(message);
        } finally {
            reorderInFlightRef.current = false;
            setReorderSaving(false);
        }
    }, [fetchCategories, selectedLocale]);

    const handleDragEnd = useCallback(async (event: DragEndEvent) => {
        const { active, over } = event;
        if (
            reorderInFlightRef.current ||
            !over ||
            active.id === over.id
        ) {
            return;
        }

        const oldIndex = categories.findIndex((category) => category.id === active.id);
        const newIndex = categories.findIndex((category) => category.id === over.id);
        if (oldIndex === -1 || newIndex === -1) {
            return;
        }

        await persistRootOrder(
            categories,
            arrayMove(categories, oldIndex, newIndex)
        );
    }, [categories, persistRootOrder]);

    const moveRootCategory = useCallback(async (
        categoryId: number,
        direction: "up" | "down"
    ) => {
        if (reorderInFlightRef.current) return;
        const currentIndex = categories.findIndex(
            (category) => category.id === categoryId
        );
        const nextIndex =
            direction === "up" ? currentIndex - 1 : currentIndex + 1;
        if (
            currentIndex < 0 ||
            nextIndex < 0 ||
            nextIndex >= categories.length
        ) {
            return;
        }
        await persistRootOrder(
            categories,
            arrayMove(categories, currentIndex, nextIndex)
        );
    }, [categories, persistRootOrder]);

    const handleSave = useCallback(async () => {
        if (!formName.trim()) {
            setFormError("Kategori adı boş olamaz.");
            return;
        }

        setFormSaving(true);
        setFormError("");

        try {
            const response = await fetch(
                editing ? `/api/admin/categories/${editing.id}` : "/api/admin/categories",
                {
                    method: editing ? "PUT" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: formName.trim(),
                        color: formColor.trim() || null,
                        parentId: formParentId,
                        isVisible: formVisible,
                        locale: selectedLocale,
                    }),
                }
            );

            const payload = await response.json().catch(() => null) as { error?: string } | null;
            if (!response.ok) {
                setFormError(payload?.error ?? "Kategori kaydedilemedi.");
                return;
            }

            setFormOpen(false);
            setPageError("");
            await fetchCategories();
        } catch {
            setFormError("Kategori kaydı sırasında ağ hatası oluştu.");
        } finally {
            setFormSaving(false);
        }
    }, [editing, fetchCategories, formColor, formName, formParentId, formVisible, selectedLocale]);

    const handleDelete = useCallback(async () => {
        if (!deleteCandidate) {
            return;
        }

        setDeleteSaving(true);
        setDeleteError("");
        try {
            const response = deleteRequiresMove
                ? await fetch(`/api/admin/categories/${deleteCandidate.id}/move-delete`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ targetCategoryId: Number.parseInt(deleteTargetId, 10) }),
                })
                : await fetch(`/api/admin/categories/${deleteCandidate.id}`, {
                    method: "DELETE",
                });
            const payload = await response.json().catch(() => null) as { error?: string } | null;

            if (!response.ok) {
                const message = payload?.error ?? "Kategori silinemedi.";
                setDeleteError(message);
                setPageError(message);
                return;
            }

            setDeleteOpen(false);
            setDeleteCandidate(null);
            setDeleteTargetId("");
            setDeleteError("");
            setPageError("");
            await fetchCategories();
        } catch {
            const message = "Kategori silinirken ağ hatası oluştu.";
            setDeleteError(message);
            setPageError(message);
        } finally {
            setDeleteSaving(false);
        }
    }, [deleteCandidate, deleteRequiresMove, deleteTargetId, fetchCategories]);

    const toggleVisibility = useCallback(async (category: Category) => {
        try {
            const response = await fetch(`/api/admin/categories/${category.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isVisible: !category.isVisible }),
            });
            const payload = await response.json().catch(() => null) as { error?: string } | null;

            if (!response.ok) {
                setPageError(payload?.error ?? "Görünürlük güncellenemedi.");
                return;
            }

            setPageError("");
            await fetchCategories();
        } catch {
            setPageError("Görünürlük güncellenirken ağ hatası oluştu.");
        }
    }, [fetchCategories]);

    const toggleExpand = useCallback((categoryId: number) => {
        setExpanded((current) => {
            const next = new Set(current);
            if (next.has(categoryId)) {
                next.delete(categoryId);
            } else {
                next.add(categoryId);
            }
            return next;
        });
    }, []);

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
                        <FolderTree className="h-6 w-6 text-amber-500" />
                        Kategori Yönetimi
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Toplam {totalCategories} kategori. Ana kategorileri sürükleyin veya oklarla taşıyın; alt kategoriler kendi ana kategorisi altında kalır.
                    </p>
                    {reorderSaving ? (
                        <div
                            role="status"
                            aria-live="polite"
                            className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
                        >
                            <Loader2 size={12} className="animate-spin" />
                            Sıralama kaydediliyor
                        </div>
                    ) : null}
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <select
                        value={selectedLocale}
                        onChange={(event) => setSelectedLocale(event.target.value as GameContentLocale)}
                        className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-bold"
                        aria-label="Kelime paketi dili"
                    >
                        {GAME_CONTENT_LOCALES.map((locale) => (
                            <option key={locale} value={locale}>
                                {GAME_CONTENT_LOCALE_DEFINITIONS[locale].adminLabel}
                            </option>
                        ))}
                    </select>
                    <button
                        onClick={() => openCreate(null)}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-colors active:scale-95 hover:bg-amber-600 sm:w-auto"
                    >
                        <Plus size={18} />
                        Yeni kategori
                    </button>
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.9fr)]">
                <div className="rounded-2xl border border-amber-200/70 bg-amber-50/70 px-5 py-4 text-sm text-amber-950 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
                    <p className="font-semibold">Kategori politikası</p>
                    <p className="mt-2 text-amber-900/90 dark:text-amber-100/90">
                        Ana kategori isterse genel kelime havuzu taşıyabilir. Daha spesifik havuzlar için alt kategori aç.
                    </p>
                    <p className="mt-2 text-amber-900/90 dark:text-amber-100/90">
                        Aynı kelimeyi hem ana kategoriye hem de onun alt kategorisine birlikte bağlamıyoruz. Kelime tarafında bu kural zaten zorunlu.
                    </p>
                    <p className="mt-2 text-amber-900/90 dark:text-amber-100/90">
                        Şu an taksonomi iki seviye: ana kategori ve alt kategori. Alt kategorinin altına yeni kategori açılamaz.
                    </p>
                    <p className="mt-2 text-amber-900/90 dark:text-amber-100/90">
                        Sürükle-bırak ve sıralama okları yalnızca ana kategoriler içindir. Alt kategoriler kendi üst kategorisinin altında kalır.
                    </p>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800">
                    <p className="font-semibold text-slate-900 dark:text-white">Ağaç özeti</p>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                        <div className="rounded-xl bg-slate-50 px-3 py-3 dark:bg-slate-900">
                            <div className="text-xl font-bold text-slate-900 dark:text-white">{totalCategories}</div>
                            <div className="mt-1 text-xs text-slate-500">toplam</div>
                        </div>
                        <div className="rounded-xl bg-slate-50 px-3 py-3 dark:bg-slate-900">
                            <div className="text-xl font-bold text-slate-900 dark:text-white">{categories.length}</div>
                            <div className="mt-1 text-xs text-slate-500">ana</div>
                        </div>
                        <div className="rounded-xl bg-slate-50 px-3 py-3 dark:bg-slate-900">
                            <div className="text-xl font-bold text-slate-900 dark:text-white">{totalSubcategories}</div>
                            <div className="mt-1 text-xs text-slate-500">alt</div>
                        </div>
                    </div>
                </div>
            </div>

            {pageError ? (
                <div
                    role="alert"
                    className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
                >
                    {pageError}
                </div>
            ) : null}

            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 size={24} className="animate-spin text-amber-500" />
                    </div>
                ) : categories.length === 0 ? (
                    <div className="py-16 text-center text-gray-400">
                        <FolderTree size={32} className="mx-auto mb-3 opacity-30" />
                        <p>Henüz kategori yok.</p>
                    </div>
                ) : (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={categories.map((category) => category.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            <div className="divide-y divide-gray-50 dark:divide-slate-800">
                                {categories.map((category, index) => (
                                    <SortableCategory
                                        key={category.id}
                                        category={category}
                                        expanded={expanded}
                                        onCreateChild={openCreate}
                                        onDelete={(selectedCategory) => {
                                            setDeleteCandidate(selectedCategory);
                                            setDeleteTargetId("");
                                            setDeleteError("");
                                            setDeleteOpen(true);
                                        }}
                                        onEdit={openEdit}
                                        onToggleExpand={toggleExpand}
                                        onToggleVisibility={toggleVisibility}
                                        onMove={moveRootCategory}
                                        position={index}
                                        total={categories.length}
                                        reorderSaving={reorderSaving}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                )}
            </div>

            {formOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800">
                        <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-slate-700">
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white">
                                {editing ? "Kategoriyi Düzenle" : formParentId ? "Alt Kategori Ekle" : "Yeni Kategori"}
                            </h3>
                            <button
                                onClick={() => setFormOpen(false)}
                                className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-4 p-5">
                            {formError ? (
                                <div className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-600 dark:bg-red-900/20 dark:text-red-400">
                                    {formError}
                                </div>
                            ) : null}

                            {currentParentLabel ? (
                                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
                                    Bu kayıt <span className="font-semibold">{currentParentLabel}</span> alt kategorisi olarak oluşacak.
                                </div>
                            ) : null}

                            <div>
                                <label className="mb-1.5 block text-sm font-semibold text-gray-600 dark:text-gray-300">
                                    Kategori Adı
                                </label>
                                <input
                                    type="text"
                                    value={formName}
                                    onChange={(event) => setFormName(event.target.value)}
                                    placeholder="Kategori adı..."
                                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-500 dark:border-slate-700 dark:bg-slate-900"
                                />
                            </div>

                            <div>
                                <label className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-gray-600 dark:text-gray-300">
                                    <Palette size={14} />
                                    Renk
                                </label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="color"
                                        value={formColor}
                                        onChange={(event) => setFormColor(event.target.value)}
                                        className="h-10 w-10 cursor-pointer rounded-xl border-2 border-gray-200 dark:border-slate-600"
                                    />
                                    <input
                                        type="text"
                                        value={formColor}
                                        onChange={(event) => setFormColor(event.target.value)}
                                        className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-amber-500 dark:border-slate-700 dark:bg-slate-900"
                                    />
                                </div>
                            </div>

                            {!editing?.parentId && !formParentId ? (
                                <div>
                                    <label className="mb-1.5 block text-sm font-semibold text-gray-600 dark:text-gray-300">
                                        Üst Kategori (Opsiyonel)
                                    </label>
                                    <select
                                        value={formParentId ?? ""}
                                        onChange={(event) =>
                                            setFormParentId(event.target.value ? Number.parseInt(event.target.value, 10) : null)
                                        }
                                        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-500 dark:border-slate-700 dark:bg-slate-900"
                                    >
                                        <option value="">Ana kategori (kök)</option>
                                        {rootCategoryOptions.map((category) => (
                                            <option key={category.id} value={category.id}>
                                                {category.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ) : null}

                            {!editing && formParentId === null ? (
                                <p className="text-xs leading-5 text-muted-foreground">
                                    Ana kategoriye doğrudan kelime eklemek genel havuz anlamına gelir. Daha spesifik bir havuz gerekiyorsa alt kategori aç.
                                </p>
                            ) : null}

                            <label className="flex cursor-pointer items-center gap-3">
                                <input
                                    type="checkbox"
                                    checked={formVisible}
                                    onChange={(event) => setFormVisible(event.target.checked)}
                                    className="rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                                />
                                <span className="text-sm text-gray-600 dark:text-gray-300">
                                    Oyuncular tarafından görünür
                                </span>
                            </label>
                        </div>

                        <div className="flex justify-end gap-3 border-t border-gray-100 p-5 dark:border-slate-700">
                            <button
                                onClick={() => setFormOpen(false)}
                                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
                            >
                                İptal
                            </button>
                            <button
                                onClick={() => void handleSave()}
                                disabled={formSaving}
                                className="flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md transition-colors active:scale-95 hover:bg-amber-600 disabled:opacity-50"
                            >
                                {formSaving ? <Loader2 size={16} className="animate-spin" /> : null}
                                {editing ? "Güncelle" : "Kaydet"}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {deleteOpen && deleteCandidate ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-2xl border border-gray-100 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800">
                        <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-slate-700">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800 dark:text-white">Kategoriyi Sil</h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {deleteCandidate.name}
                                </p>
                            </div>
                            <button
                                onClick={() => {
                                    setDeleteOpen(false);
                                    setDeleteCandidate(null);
                                    setDeleteTargetId("");
                                    setDeleteError("");
                                }}
                                className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-4 p-5">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-900">
                                    <div className="text-xs text-slate-500">Bağlı kelime</div>
                                    <div className="mt-1 text-xl font-bold text-slate-900 dark:text-white">
                                        {deleteCandidate.wordCount}
                                    </div>
                                </div>
                                <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-900">
                                    <div className="text-xs text-slate-500">Alt kategori</div>
                                    <div className="mt-1 text-xl font-bold text-slate-900 dark:text-white">
                                        {deleteCandidate.childCount}
                                    </div>
                                </div>
                            </div>

                            {deleteRequiresMove ? (
                                <div className="space-y-3">
                                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                                        Bu kategori boş değil. Silmeden önce bağlı kelimeler ve varsa alt kategoriler başka bir kategoriye taşınacak.
                                    </div>
                                    <div>
                                        <label className="mb-1.5 block text-sm font-semibold text-gray-600 dark:text-gray-300">
                                            Hedef kategori
                                        </label>
                                        <select
                                            value={deleteTargetId}
                                            onChange={(event) => setDeleteTargetId(event.target.value)}
                                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-500 dark:border-slate-700 dark:bg-slate-900"
                                        >
                                            <option value="">Hedef kategori seç</option>
                                            {deleteTargetOptions.map((category) => (
                                                <option key={category.id} value={String(category.id)}>
                                                    {category.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                                    Bu kategori boş. Doğrudan silinecek.
                                </div>
                            )}

                            {deleteError ? (
                                <div className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-600 dark:bg-red-900/20 dark:text-red-400">
                                    {deleteError}
                                </div>
                            ) : null}
                        </div>

                        <div className="flex justify-end gap-3 border-t border-gray-100 p-5 dark:border-slate-700">
                            <button
                                onClick={() => {
                                    setDeleteOpen(false);
                                    setDeleteCandidate(null);
                                    setDeleteTargetId("");
                                    setDeleteError("");
                                }}
                                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
                            >
                                Vazgeç
                            </button>
                            <button
                                onClick={() => void handleDelete()}
                                disabled={deleteSaving || (deleteRequiresMove && !deleteTargetId)}
                                className="flex items-center gap-2 rounded-xl bg-red-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md transition-colors active:scale-95 hover:bg-red-700 disabled:opacity-50"
                            >
                                {deleteSaving ? <Loader2 size={16} className="animate-spin" /> : null}
                                {deleteRequiresMove ? "Taşıyıp Sil" : "Sil"}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
