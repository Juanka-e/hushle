"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Youtube from "@tiptap/extension-youtube";
import {
    Bold,
    Italic,
    List,
    ListOrdered,
    Heading2,
    Link2,
    Unlink,
    Youtube as YoutubeIcon,
    Image as ImageIcon,
    Undo,
    Redo,
    Minus,
} from "lucide-react";
import { useCallback, useState } from "react";

interface RichTextEditorProps {
    content: string;
    onChange: (content: string) => void;
    placeholder?: string;
}

export function RichTextEditor({
    content,
    onChange,
    placeholder = "İçerik yazın...",
}: RichTextEditorProps) {
    const [youtubeUrl, setYoutubeUrl] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [showYoutubeInput, setShowYoutubeInput] = useState(false);
    const [showImageInput, setShowImageInput] = useState(false);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                bulletList: {
                    HTMLAttributes: {
                        class: "list-disc pl-4",
                    },
                },
                orderedList: {
                    HTMLAttributes: {
                        class: "list-decimal pl-4",
                    },
                },
            }),
            Placeholder.configure({
                placeholder,
            }),
            Link.configure({
                openOnClick: false,
                HTMLAttributes: {
                    class: "text-blue-600 underline cursor-pointer",
                },
            }),
            Youtube.configure({
                controls: false,
                nocookie: true,
                HTMLAttributes: {
                    class: "aspect-video rounded-lg overflow-hidden",
                },
            }),
        ],
        content,
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML());
        },
        editorProps: {
            attributes: {
                class:
                    "prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[200px] p-4",
            },
        },
    });

    const setLink = useCallback(() => {
        const url = window.prompt("Link URL:");
        if (url && editor) {
            editor.chain().focus().setLink({ href: url }).run();
        }
    }, [editor]);

    const addYoutube = useCallback(() => {
        if (youtubeUrl && editor) {
            // YouTube URL'sini embed formatına çevir
            const videoId = youtubeUrl.match(
                /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/
            )?.[1];
            if (videoId) {
                const embedUrl = `https://www.youtube.com/embed/${videoId}`;
                editor.chain().focus().setYoutubeVideo({ src: embedUrl }).run();
                setYoutubeUrl("");
                setShowYoutubeInput(false);
            } else {
                alert("Geçerli bir YouTube URL'si girin.");
            }
        }
    }, [editor, youtubeUrl]);

    const addImage = useCallback(() => {
        if (imageUrl && editor) {
            // HTML img tag'i olarak ekle
            editor
                .chain()
                .focus()
                .insertContent(
                    `<img src="${imageUrl}" class="max-w-full h-auto rounded-lg" />`
                )
                .run();
            setImageUrl("");
            setShowImageInput(false);
        }
    }, [editor, imageUrl]);

    if (!editor) {
        return (
            <div className="w-full h-64 bg-gray-50 dark:bg-slate-800 rounded-xl animate-pulse" />
        );
    }

    return (
        <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-1 p-2 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
                <button
                    onClick={() => editor.chain().focus().toggleBold().run()}
                    className={`p-2 rounded-lg transition-colors ${
                        editor.isActive("bold")
                            ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                            : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-slate-700"
                    }`}
                    title="Kalın"
                >
                    <Bold size={16} />
                </button>

                <button
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                    className={`p-2 rounded-lg transition-colors ${
                        editor.isActive("italic")
                            ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                            : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-slate-700"
                    }`}
                    title="İtalik"
                >
                    <Italic size={16} />
                </button>

                <button
                    onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                    className={`p-2 rounded-lg transition-colors ${
                        editor.isActive("heading", { level: 2 })
                            ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                            : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-slate-700"
                    }`}
                    title="Başlık"
                >
                    <Heading2 size={16} />
                </button>

                <div className="w-px h-6 bg-gray-300 dark:bg-slate-600 mx-1" />

                <button
                    onClick={() => editor.chain().focus().toggleBulletList().run()}
                    className={`p-2 rounded-lg transition-colors ${
                        editor.isActive("bulletList")
                            ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                            : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-slate-700"
                    }`}
                    title="Liste"
                >
                    <List size={16} />
                </button>

                <button
                    onClick={() => editor.chain().focus().toggleOrderedList().run()}
                    className={`p-2 rounded-lg transition-colors ${
                        editor.isActive("orderedList")
                            ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                            : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-slate-700"
                    }`}
                    title="Numaralı Liste"
                >
                    <ListOrdered size={16} />
                </button>

                <div className="w-px h-6 bg-gray-300 dark:bg-slate-600 mx-1" />

                <button
                    onClick={setLink}
                    className={`p-2 rounded-lg transition-colors ${
                        editor.isActive("link")
                            ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                            : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-slate-700"
                    }`}
                    title="Link Ekle"
                >
                    <Link2 size={16} />
                </button>

                {editor.isActive("link") && (
                    <button
                        onClick={() => editor.chain().focus().unsetLink().run()}
                        className="p-2 rounded-lg text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-slate-700"
                        title="Link Kaldır"
                    >
                        <Unlink size={16} />
                    </button>
                )}

                <button
                    onClick={() => setShowImageInput(!showImageInput)}
                    className="p-2 rounded-lg text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-slate-700"
                    title="Görsel Ekle"
                >
                    <ImageIcon size={16} />
                </button>

                <button
                    onClick={() => setShowYoutubeInput(!showYoutubeInput)}
                    className="p-2 rounded-lg text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-slate-700"
                    title="YouTube Ekle"
                >
                    <YoutubeIcon size={16} />
                </button>

                <div className="w-px h-6 bg-gray-300 dark:bg-slate-600 mx-1" />

                <button
                    onClick={() => editor.chain().focus().undo().run()}
                    className="p-2 rounded-lg text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-slate-700"
                    title="Geri Al"
                >
                    <Undo size={16} />
                </button>

                <button
                    onClick={() => editor.chain().focus().redo().run()}
                    className="p-2 rounded-lg text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-slate-700"
                    title="İleri Al"
                >
                    <Redo size={16} />
                </button>

                <button
                    onClick={() => editor.chain().focus().setHorizontalRule().run()}
                    className="p-2 rounded-lg text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-slate-700 ml-auto"
                    title="Ayıraç Ekle"
                >
                    <Minus size={16} />
                </button>
            </div>

            {/* YouTube Input */}
            {showYoutubeInput && (
                <div className="flex items-center gap-2 p-2 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
                    <input
                        type="text"
                        value={youtubeUrl}
                        onChange={(e) => setYoutubeUrl(e.target.value)}
                        placeholder="YouTube URL (https://www.youtube.com/watch?v=...)"
                        className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        onKeyDown={(e) => e.key === "Enter" && addYoutube()}
                    />
                    <button
                        onClick={addYoutube}
                        className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium"
                    >
                        Ekle
                    </button>
                    <button
                        onClick={() => {
                            setShowYoutubeInput(false);
                            setYoutubeUrl("");
                        }}
                        className="px-3 py-2 text-gray-500 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-lg text-sm"
                    >
                        İptal
                    </button>
                </div>
            )}

            {/* Image Input */}
            {showImageInput && (
                <div className="flex items-center gap-2 p-2 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
                    <input
                        type="text"
                        value={imageUrl}
                        onChange={(e) => setImageUrl(e.target.value)}
                        placeholder="Görsel URL (https://...)"
                        className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        onKeyDown={(e) => e.key === "Enter" && addImage()}
                    />
                    <button
                        onClick={addImage}
                        className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium"
                    >
                        Ekle
                    </button>
                    <button
                        onClick={() => {
                            setShowImageInput(false);
                            setImageUrl("");
                        }}
                        className="px-3 py-2 text-gray-500 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-lg text-sm"
                    >
                        İptal
                    </button>
                </div>
            )}

            {/* Editor */}
            <EditorContent editor={editor} />
        </div>
    );
}
