export function formatPrice(price: number | string | undefined | null): string {
    if (price === undefined || price === null || isNaN(Number(price))) return '0';
    const num = Number(price);
    if (num === 0) return '0';
    // Use up to 8 decimal places, drop trailing zeros
    return parseFloat(num.toFixed(8)).toString();
}

export function formatAmount(amount: number | string | undefined | null): string {
    if (amount === undefined || amount === null || isNaN(Number(amount))) return '0';
    const num = Number(amount);
    // Use up to 4 decimal places for USDT amounts/balances, drop trailing zeros
    return parseFloat(num.toFixed(4)).toString();
}
