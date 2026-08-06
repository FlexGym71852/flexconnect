# Flex Connect — Static GitHub Pages Edition

This folder is the complete website. It uses plain HTML, CSS, and JavaScript.
There is no backend, build command, package installation, workflow, database,
IndexedDB, localStorage, sessionStorage, service worker, or browser cache used
for business data.

## Publish

Put `index.html`, `styles.css`, and `app.js` at the root of any static host or
GitHub Pages repository. No custom build action, repository variable, base-path
setting, or server is required. All asset links are relative, so both account
pages and project pages work unchanged.

## First launch

Open the page in current desktop Chrome or Edge and select **Choose storage
folder**. The browser asks for permission, then Flex Connect creates or opens
`flex-connect-data.json` in that folder. Every member, plan, visit, sale,
product, device setting, and report change is written directly to that file.

The folder must be selected again after reopening the page. Flex Connect does
this intentionally because remembering a directory handle would require a
browser database, which this edition never uses.

## Stripe

Create a Stripe Payment Link for each recurring product in Stripe, then paste
the link into the corresponding membership option. Signup opens Stripe's
secure hosted checkout. Card details and secret Stripe keys never enter this
website. After payment, use the member's **Payment** action to activate the
member and add the payment to local revenue and tax reports.

## Hardware

- Web NFC: Android Chrome on a device with NFC.
- External NFC: USB/serial readers through Web Serial, keyboard-mode readers,
  or a secure WebSocket reader.
- Door control: Web Bluetooth LE or an HTTPS Wi-Fi controller that permits the
  page origin. Configure commands, URLs, and Bluetooth UUIDs under Settings.

Hardware permission prompts appear only when the operator presses the related
connect, scan, or write button.

## Visual website editor

Open **Edit Website** and paste a fine-grained GitHub personal access token
with Metadata read and Contents read/write permission for the selected website
repositories. Choose a repository, branch, and HTML page, then edit its text,
images, buttons, and links using visual controls. Publishing creates one GitHub
commit. The token stays only in the current page's memory and is never saved.
