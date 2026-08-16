import St from 'gi://St';

// The shell owns the selection itself, so the text outlives the dictation with
// no helper process holding it.
export function copyText(text: string): void {
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
}
