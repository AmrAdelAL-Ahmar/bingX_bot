import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

async function testModel(modelName: string) {
    console.log(`\nTesting model: ${modelName}...`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: 'Respond with: "OK"' }] }]
            })
        });
        const data: any = await res.json();
        console.log(`Status: ${res.status}`);
        if (res.ok) {
            console.log('Result:', data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim());
        } else {
            console.log('Error:', data?.error?.message || data);
        }
    } catch (e: any) {
        console.log('Exception:', e.message);
    }
}

async function run() {
    await testModel('gemini-1.5-flash');
    await testModel('gemini-2.0-flash');
    await testModel('gemini-3.6-flash');
}

run();
