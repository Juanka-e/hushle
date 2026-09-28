"use client";

import type { AnnouncementBlocks } from "@/lib/announcements/content";

interface AnnouncementBlocksViewProps {
    blocks: AnnouncementBlocks;
    className?: string;
}

export function AnnouncementBlocksView({
    blocks,
    className = "",
}: AnnouncementBlocksViewProps) {
    return (
        <div className={`space-y-3 text-sm leading-6 text-slate-600 dark:text-slate-300 ${className}`.trim()}>
            {blocks.map((block, index) => {
                switch (block.type) {
                    case "paragraph":
                        return <p key={index}>{block.text}</p>;
                    case "quote":
                        return (
                            <blockquote
                                key={index}
                                className="border-l-4 border-blue-500/60 pl-4 italic text-slate-700 dark:text-slate-200"
                            >
                                {block.text}
                            </blockquote>
                        );
                    case "heading":
                        return block.level === 3 ? (
                            <h3 key={index} className="text-base font-bold text-slate-800 dark:text-white">
                                {block.text}
                            </h3>
                        ) : (
                            <h2 key={index} className="text-lg font-black text-slate-900 dark:text-white">
                                {block.text}
                            </h2>
                        );
                    case "bullet_list":
                        return (
                            <ul key={index} className="list-disc space-y-1 pl-5">
                                {block.items.map((item, itemIndex) => (
                                    <li key={itemIndex}>{item}</li>
                                ))}
                            </ul>
                        );
                    case "ordered_list":
                        return (
                            <ol key={index} className="list-decimal space-y-1 pl-5">
                                {block.items.map((item, itemIndex) => (
                                    <li key={itemIndex}>{item}</li>
                                ))}
                            </ol>
                        );
                    case "divider":
                        return <hr key={index} className="border-slate-200 dark:border-slate-700" />;
                    default:
                        return null;
                }
            })}
        </div>
    );
}
