"use client";

import {
    ChevronDown,
    ChevronUp,
    Heading2,
    List,
    ListOrdered,
    Minus,
    Plus,
    Quote,
    Text,
    Trash2,
} from "lucide-react";
import type {
    AnnouncementBlock,
    AnnouncementBlocks,
    AnnouncementBlockType,
} from "@/lib/announcements/content";
import {
    ANNOUNCEMENT_BODY_TEXT_MAX_LENGTH,
    ANNOUNCEMENT_HEADING_TEXT_MAX_LENGTH,
    ANNOUNCEMENT_LIST_ITEM_MAX_LENGTH,
} from "@/lib/announcements/content";

const blockTypeOptions: Array<{
    type: AnnouncementBlockType;
    label: string;
    icon: typeof Text;
}> = [
    { type: "paragraph", label: "Paragraf", icon: Text },
    { type: "heading", label: "Başlık", icon: Heading2 },
    { type: "quote", label: "Alıntı", icon: Quote },
    { type: "bullet_list", label: "Madde Listesi", icon: List },
    { type: "ordered_list", label: "Sıralı Liste", icon: ListOrdered },
    { type: "divider", label: "Ayırıcı", icon: Minus },
];

function createBlock(type: AnnouncementBlockType): AnnouncementBlock {
    switch (type) {
        case "heading":
            return { type, level: 2, text: "Başlık" };
        case "quote":
            return { type, text: "Kısa bir alıntı veya vurgu yazısı." };
        case "bullet_list":
        case "ordered_list":
            return { type, items: ["İlk madde"] };
        case "divider":
            return { type };
        default:
            return { type: "paragraph", text: "Duyuru metni" };
    }
}

interface AnnouncementBlocksEditorProps {
    value: AnnouncementBlocks;
    onChange: (nextValue: AnnouncementBlocks) => void;
}

export function AnnouncementBlocksEditor({
    value,
    onChange,
}: AnnouncementBlocksEditorProps) {
    const replaceBlock = (index: number, nextBlock: AnnouncementBlock) => {
        const nextBlocks = [...value];
        nextBlocks[index] = nextBlock;
        onChange(nextBlocks as AnnouncementBlocks);
    };

    const moveBlock = (index: number, direction: -1 | 1) => {
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= value.length) {
            return;
        }

        const nextBlocks = [...value];
        const [block] = nextBlocks.splice(index, 1);
        nextBlocks.splice(nextIndex, 0, block);
        onChange(nextBlocks as AnnouncementBlocks);
    };

    const removeBlock = (index: number) => {
        if (value.length === 1) {
            onChange([{ type: "paragraph", text: "" }] as AnnouncementBlocks);
            return;
        }

        onChange(value.filter((_, blockIndex) => blockIndex !== index) as AnnouncementBlocks);
    };

    const addBlock = (type: AnnouncementBlockType) => {
        onChange([...value, createBlock(type)] as AnnouncementBlocks);
    };

    return (
        <div className="space-y-3">
            {value.map((block, index) => {
                const blockTypeMeta =
                    blockTypeOptions.find((option) => option.type === block.type) ?? blockTypeOptions[0];
                const BlockIcon = blockTypeMeta.icon;

                return (
                    <div
                        key={`${block.type}-${index}`}
                        className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                    >
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
                                    <BlockIcon size={16} />
                                </span>
                                <select
                                    value={block.type}
                                    onChange={(event) =>
                                        replaceBlock(index, createBlock(event.target.value as AnnouncementBlockType))
                                    }
                                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950"
                                >
                                    {blockTypeOptions.map((option) => (
                                        <option key={option.type} value={option.type}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => moveBlock(index, -1)}
                                    disabled={index === 0}
                                    className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-slate-900 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                                    title="Yukarı taşı"
                                >
                                    <ChevronUp size={16} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => moveBlock(index, 1)}
                                    disabled={index === value.length - 1}
                                    className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-slate-900 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                                    title="Aşağı taşı"
                                >
                                    <ChevronDown size={16} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => removeBlock(index)}
                                    className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                                    title="Bloğu sil"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>

                        {block.type === "heading" && (
                            <div className="mb-3">
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                                    Başlık seviyesi
                                </label>
                                <select
                                    value={block.level}
                                    onChange={(event) =>
                                        replaceBlock(index, {
                                            ...block,
                                            level: Number(event.target.value) as 2 | 3,
                                        })
                                    }
                                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950"
                                >
                                    <option value={2}>H2</option>
                                    <option value={3}>H3</option>
                                </select>
                            </div>
                        )}

                        {"text" in block && (
                            <div className="space-y-2">
                                <textarea
                                    value={block.text}
                                    maxLength={
                                        block.type === "heading"
                                            ? ANNOUNCEMENT_HEADING_TEXT_MAX_LENGTH
                                            : ANNOUNCEMENT_BODY_TEXT_MAX_LENGTH
                                    }
                                    onChange={(event) =>
                                        replaceBlock(index, { ...block, text: event.target.value })
                                    }
                                    rows={block.type === "heading" ? 2 : block.type === "quote" ? 3 : 5}
                                    placeholder={
                                        block.type === "quote"
                                            ? "Kısa bir alıntı veya vurgu metni yazın."
                                            : "Duyuru içeriğini yazın."
                                    }
                                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950"
                                />
                                <div className="text-right text-xs text-gray-400 dark:text-slate-500">
                                    {block.text.length}/
                                    {block.type === "heading"
                                        ? ANNOUNCEMENT_HEADING_TEXT_MAX_LENGTH
                                        : ANNOUNCEMENT_BODY_TEXT_MAX_LENGTH}
                                </div>
                            </div>
                        )}

                        {"items" in block && (
                            <div className="space-y-2">
                                <textarea
                                    value={block.items.join("\n")}
                                    onChange={(event) =>
                                        replaceBlock(index, {
                                            ...block,
                                            items: event.target.value
                                                .split(/\r?\n/)
                                                .map((item) => item.trim().slice(0, ANNOUNCEMENT_LIST_ITEM_MAX_LENGTH))
                                                .filter(Boolean)
                                                .slice(0, 12),
                                        })
                                    }
                                    rows={5}
                                    placeholder="Her satıra bir madde yazın."
                                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950"
                                />
                                <div className="text-right text-xs text-gray-400 dark:text-slate-500">
                                    Madde başı en fazla {ANNOUNCEMENT_LIST_ITEM_MAX_LENGTH} karakter.
                                </div>
                            </div>
                        )}

                        {block.type === "divider" && (
                            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
                                Bu blok duyuru içine görsel bir ayırıcı ekler.
                            </div>
                        )}
                    </div>
                );
            })}

            <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">Yeni blok ekle</p>
                <div className="flex flex-wrap gap-2">
                    {blockTypeOptions.map((option) => {
                        const OptionIcon = option.icon;
                        return (
                            <button
                                key={option.type}
                                type="button"
                                onClick={() => addBlock(option.type)}
                                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-blue-800 dark:hover:text-blue-300"
                            >
                                <Plus size={14} />
                                <OptionIcon size={14} />
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
