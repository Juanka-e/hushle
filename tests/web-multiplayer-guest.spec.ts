import { expect, test, type Page } from "@playwright/test";

test.skip(
  process.env.WEB_MULTIPLAYER_E2E !== "true",
  "WEB_MULTIPLAYER_E2E=true is required for the seeded multiplayer flow"
);

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      )
    )
    .toBe(true);
}

test("four guests form two playable teams and enter the first transition", async ({
  browser,
  page: hostPage,
}, testInfo) => {
  const checkpoint = (message: string): void => {
    console.log(`[multiplayer:${testInfo.project.name}] ${message}`);
  };
  const suffix = `${testInfo.project.name}-${Date.now()}`.replaceAll(/[^a-z0-9]/gi, "").slice(-10);
  const hostName = `Host${suffix}`;
  const guestName = `Guest${suffix}`;
  const thirdName = `Third${suffix}`;
  const fourthName = `Fourth${suffix}`;
  const hostErrors = collectPageErrors(hostPage);
  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  let guestPage = await guestContext.newPage();
  const guestErrors = collectPageErrors(guestPage);
  const supportContext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
  });
  const thirdPage = await supportContext.newPage();
  const fourthPage = await supportContext.newPage();
  const thirdErrors = collectPageErrors(thirdPage);
  const fourthErrors = collectPageErrors(fourthPage);

  try {
    let roomCode: string | undefined;

    await test.step("host creates a room", async () => {
      await hostPage.goto("/");
      await hostPage.getByPlaceholder(/Adınızı girin|Enter your name/i).fill(hostName);
      await hostPage.getByRole("button", { name: /Yeni Oda Oluştur|Create New Room/i }).click();
      await expect(hostPage).toHaveURL(/\/room\/[A-Z0-9]{6}$/, {
        timeout: 20_000,
      });

      roomCode = new URL(hostPage.url()).pathname.split("/").at(-1);
      expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);
      await expect(hostPage.getByText(hostName, { exact: true }).first()).toBeVisible({
        timeout: 20_000,
      });
      checkpoint(`room ${roomCode} created`);
    });

    await test.step("second guest joins the room", async () => {
      await guestPage.goto("/");
      await guestPage.getByPlaceholder(/Adınızı girin|Enter your name/i).fill(guestName);
      await guestPage.getByPlaceholder(/Örn: ABC123|E.g.: ABC123/i).fill(roomCode ?? "");
      await guestPage.getByRole("button", { name: /^Katıl$|^Join$/i }).click();
      try {
        await expect(guestPage).toHaveURL(new RegExp(`/room/${roomCode}$`), {
          timeout: 20_000,
        });
      } catch (error) {
        const pageText = (await guestPage.locator("body").innerText()).replaceAll(/\s+/g, " ");
        checkpoint(`guest entry stayed at ${guestPage.url()}: ${pageText.slice(0, 500)}`);
        throw error;
      }

      await expect(hostPage.getByText(guestName, { exact: true }).first()).toBeVisible({
        timeout: 20_000,
      });
      await expect(guestPage.getByRole("button", { name: /Kategoriler/i })).toBeVisible({
        timeout: 20_000,
      });
      await expectNoHorizontalOverflow(guestPage);
      const blockedStartButton = hostPage.getByRole("button", {
        name: /Oyunu Ba/i,
      });
      const startRequirement = hostPage.getByRole("tooltip");
      await expect(blockedStartButton).toBeDisabled();
      await blockedStartButton.hover();
      await expect(startRequirement).toHaveCSS("opacity", "1");
      await expect(startRequirement).toHaveText(
        "Her iki takımda en az iki oyuncu olmalı!"
      );
      await blockedStartButton.dispatchEvent("click");
      await expect(startRequirement).toHaveAttribute(
        "data-click-visible",
        "true"
      );
      await expect(startRequirement).toHaveAttribute(
        "data-click-visible",
        "false",
        { timeout: 2_500 }
      );
      checkpoint(`${guestName} joined`);
    });

    await test.step("two more guests complete two playable teams", async () => {
      const supportPlayers: Array<[Page, string]> = [
        [thirdPage, thirdName],
        [fourthPage, fourthName],
      ];

      for (const [playerPage, playerName] of supportPlayers) {
        await playerPage.goto("/");
        await playerPage.getByPlaceholder(/Adınızı girin|Enter your name/i).fill(playerName);
        await playerPage
          .getByPlaceholder(/Örn: ABC123|E.g.: ABC123/i)
          .fill(roomCode ?? "");
        await playerPage.getByRole("button", { name: /^Katıl$|^Join$/i }).click();
        await expect(playerPage).toHaveURL(new RegExp(`/room/${roomCode}$`), {
          timeout: 20_000,
        });
        await expect(
          hostPage.getByText(playerName, { exact: true }).first()
        ).toBeVisible({ timeout: 20_000 });
      }

      await expect(
        hostPage.getByRole("button", { name: /Oyunu Ba/i })
      ).toBeEnabled();
      checkpoint("four active guests formed two teams");
    });

    await test.step("mobile guest can open both team sidebars", async () => {
      const teamAToggle = guestPage.getByRole("button", {
        name: "Takım A panelini aç",
      });
      const teamBToggle = guestPage.getByRole("button", {
        name: "Takım B panelini aç",
      });

      await expect(teamAToggle).toBeVisible();
      await teamAToggle.click();
      await expect(
        guestPage.getByRole("button", { name: "Takım A panelini kapat" })
      ).toBeVisible();
      await guestPage
        .getByRole("button", { name: "Takım A panelini kapat" })
        .click();

      await expect(teamBToggle).toBeVisible();
      await teamBToggle.click();
      await expect(
        guestPage.getByRole("button", { name: "Takım B panelini kapat" })
      ).toBeVisible();
      await guestPage
        .getByRole("button", { name: "Takım B panelini kapat" })
        .click();
      checkpoint("mobile team sidebars opened independently");
    });

    await test.step("both guests reconnect without identity duplication", async () => {
      const hostPlayerIdBefore = await hostPage.evaluate(() =>
        window.sessionStorage.getItem("tabu_playerId")
      );
      const guestPlayerIdBefore = await guestPage.evaluate(() =>
        window.sessionStorage.getItem("tabu_playerId")
      );
      expect(hostPlayerIdBefore).toMatch(/^(?:user:\d+|guest:[a-f0-9-]+)$/i);
      expect(guestPlayerIdBefore).toMatch(/^(?:user:\d+|guest:[a-f0-9-]+)$/i);

      await hostPage.reload();
      await expect(hostPage.getByRole("button", { name: /Kategoriler/i })).toBeVisible({
        timeout: 20_000,
      });
      await expect
        .poll(() =>
          hostPage.evaluate(() => window.sessionStorage.getItem("tabu_playerId"))
        )
        .toBe(hostPlayerIdBefore);

      await guestPage.reload();
      await expect(guestPage.getByRole("button", { name: /Kategoriler/i })).toBeVisible({
        timeout: 20_000,
      });
      await expect
        .poll(() =>
          guestPage.evaluate(() => window.sessionStorage.getItem("tabu_playerId"))
        )
        .toBe(guestPlayerIdBefore);

      await expect(hostPage.getByText(guestName, { exact: true })).toHaveCount(1);
      await expect(guestPage.getByText(hostName, { exact: true })).toHaveCount(1);
      await expect(guestPage.getByText(/otomatik devir/i)).toHaveCount(0);
      await expectNoHorizontalOverflow(guestPage);
      checkpoint("host and guest identities survived reload");
    });

    await test.step("host starts the game", async () => {
      const startButton = hostPage.getByRole("button", { name: /Oyunu Ba/i });
      await expect(startButton).toBeEnabled({ timeout: 20_000 });
      await startButton.click();

      await expect(hostPage.getByRole("heading", { name: /Oyun ba/i })).toBeVisible({
        timeout: 20_000,
      });
      await expect(guestPage.getByRole("heading", { name: /Oyun ba/i })).toBeVisible({
        timeout: 20_000,
      });
      await expectNoHorizontalOverflow(guestPage);
      checkpoint("first transition visible to both guests");
    });

    await test.step("host pauses the transition for both guests", async () => {
      await hostPage.getByRole("button", { name: /^Durdur$/i }).click();
      await expect(hostPage.getByRole("button", { name: /Devam Ettir/i })).toBeVisible({
        timeout: 20_000,
      });
      await expect(guestPage.getByText(/bekletildi/i)).toBeVisible({
        timeout: 20_000,
      });
      checkpoint("pause synchronized");
    });

    await test.step("active game reconnect restores the game instead of the lobby", async () => {
      await hostPage.getByRole("button", { name: /Devam Ettir/i }).click();
      await expect(guestPage.getByText(/^(?:ANLATICI|NARRATOR)$/i)).toBeVisible({
        timeout: 20_000,
      });

      await guestPage.reload();
      await expect(guestPage.getByText(/^(?:ANLATICI|NARRATOR)$/i)).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        guestPage.getByRole("button", { name: /Kategoriler/i })
      ).toHaveCount(0);
      await expect(
        guestPage.getByText(/Amblem Yakinda/i)
      ).toHaveCount(0);
      await expectNoHorizontalOverflow(guestPage);
      checkpoint("active game state survived guest reload");
    });

    await test.step("critical disconnect pauses until the player returns and host resumes", async () => {
      const reconnectIdentity = await guestPage.evaluate(() => ({
        playerId: window.sessionStorage.getItem("tabu_playerId"),
        guestToken: window.sessionStorage.getItem("tabu_guestToken"),
      }));
      expect(reconnectIdentity.playerId).toBeTruthy();
      expect(reconnectIdentity.guestToken).toBeTruthy();

      await guestPage.close();
      await expect(hostPage.getByText(/Bir oyuncunun bağlantısı kesildi/i)).toBeVisible({
        timeout: 20_000,
      });

      await guestContext.addInitScript((identity) => {
        if (identity.playerId) {
          window.sessionStorage.setItem("tabu_playerId", identity.playerId);
        }
        if (identity.guestToken) {
          window.sessionStorage.setItem("tabu_guestToken", identity.guestToken);
        }
      }, reconnectIdentity);
      guestPage = await guestContext.newPage();
      guestPage.on("pageerror", (error) => guestErrors.push(error.message));
      await guestPage.goto(`/room/${roomCode}`);
      await expect(guestPage.getByText(/^(?:ANLATICI|NARRATOR)$/i)).toBeVisible({
        timeout: 20_000,
      });
      await expect(hostPage.getByText(/Oyuncu yeniden bağlandı/i)).toBeVisible({
        timeout: 20_000,
      });
      await expect(hostPage.getByRole("button", { name: /Devam Ettir/i })).toBeVisible({
        timeout: 20_000,
      });
      await hostPage.getByRole("button", { name: /Devam Ettir/i }).click();
      await expect(hostPage.getByText(/Oyuncu yeniden bağlandı/i)).toHaveCount(0);
      checkpoint("critical disconnect pause and manual recovery synchronized");
    });

    expect(hostErrors).toEqual([]);
    expect(guestErrors).toEqual([]);
    expect(thirdErrors).toEqual([]);
    expect(fourthErrors).toEqual([]);
  } finally {
    await supportContext.close();
    await guestContext.close();
  }
});

test("mobile host creates a room that a desktop guest can join", async ({
  browser,
  page: desktopGuestPage,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}-reverse`
    .replaceAll(/[^a-z0-9]/gi, "")
    .slice(-10);
  const hostName = `Mobil${suffix}`;
  const guestName = `Masa${suffix}`;
  const mobileHostContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const mobileHostPage = await mobileHostContext.newPage();
  const mobileErrors = collectPageErrors(mobileHostPage);
  const desktopErrors = collectPageErrors(desktopGuestPage);

  try {
    await mobileHostPage.goto("/");
    await mobileHostPage.getByPlaceholder(/Adınızı girin|Enter your name/i).fill(hostName);
    await mobileHostPage
      .getByRole("button", { name: /Yeni Oda Oluştur|Create New Room/i })
      .click();
    await expect(mobileHostPage).toHaveURL(/\/room\/[A-Z0-9]{6}$/, {
      timeout: 20_000,
    });
    const roomCode = new URL(mobileHostPage.url()).pathname.split("/").at(-1);
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);

    await desktopGuestPage.goto("/");
    await desktopGuestPage
      .getByPlaceholder(/Adınızı girin|Enter your name/i)
      .fill(guestName);
    await desktopGuestPage
      .getByPlaceholder(/Örn: ABC123|E.g.: ABC123/i)
      .fill(roomCode ?? "");
    await desktopGuestPage.getByRole("button", { name: /^Katıl$|^Join$/i }).click();

    await expect(desktopGuestPage).toHaveURL(
      new RegExp(`/room/${roomCode}$`),
      { timeout: 20_000 }
    );
    await expect(
      mobileHostPage.getByText(guestName, { exact: true }).first()
    ).toBeVisible({ timeout: 20_000 });
    await expectNoHorizontalOverflow(mobileHostPage);
    expect(mobileErrors).toEqual([]);
    expect(desktopErrors).toEqual([]);
  } finally {
    await mobileHostContext.close();
  }
});
