import { prisma } from "../apps/web/src/lib/prisma";
import {
    announcementBlocksSchema,
    announcementBlocksToHtml,
    toAnnouncementInputJson,
} from "../apps/web/src/lib/announcements/content";

const defaultBlocks = announcementBlocksSchema.parse([
    {
        type: "paragraph",
        text: "Yeni sezon düzenlemesiyle birlikte duyuru ekranı daha temiz, okunur ve hızlı taranabilir hale getirildi. Artık önemli başlıklar daha net ayrışıyor, medya içeren duyurular kart içinde daha düzenli görünüyor ve tarih bilgisi üst bölümde sabit bir referans noktası olarak duruyor.",
    },
    {
        type: "paragraph",
        text: "Bu test duyurusu oyuncu tarafındaki yeni kart düzenini, YENİ rozeti görünümünü ve açılır detay akışını gözlemlemek için eklendi. Kart kapalıyken sadece başlık ve meta bilgisi görünmeli, tam içerik yalnızca duyuru açıldığında gösterilmelidir.",
    },
    {
        type: "bullet_list",
        items: [
            "Kapalı kartta gereksiz metin tekrarı olmamalı.",
            "Sağ üst tarih alanı hızlı taranabilir görünmeli.",
            "YENİ rozeti yalnızca kısa bir süre görünür kalmalı.",
        ],
    },
]);

async function main() {
    const announcement = await prisma.announcement.create({
        data: {
            title: "Test Duyurusu: Yeni Duyuru Kartı Kontrolü",
            content: announcementBlocksToHtml(defaultBlocks),
            contentBlocks: toAnnouncementInputJson(defaultBlocks),
            type: "duyuru",
            isVisible: true,
            isPinned: false,
            version: "test-2026-03-30",
            tags: "test,ui,duyuru",
            createdAt: new Date(),
        },
    });

    console.log(
        JSON.stringify(
            {
                ok: true,
                id: announcement.id,
                title: announcement.title,
                createdAt: announcement.createdAt.toISOString(),
            },
            null,
            2
        )
    );
}

main()
    .catch((error) => {
        console.error("Failed to seed test announcement:", error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
