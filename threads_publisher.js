const fs = require('fs');
const path = require('path');
const { NDKEvent, NDKPrivateKeySigner, NDKUser} = require('@nostr-dev-kit/ndk');
const NDK = require('@nostr-dev-kit/ndk').default;

// Constants
const ARCHIVE_USERNAME_KEY = "Lightning mailing archive";
const DIR = 'lightning_threads';
const START_YEAR = 2015;
const END_YEAR = 2023;
const THREADS_CHECKPOINTS_FILE = 'ln_checkpoints_1.json';
const SLEEP_DELAY = 100; // ms delay between actions
const KEYS_AND_FLAGS_FILE = 'keys_and_flags_1.json';
const RELAYS = [
    "wss://eden.nostr.land",
    "wss://nostr.mutinywallet.com",
    "wss://puravida.nostr.land",
    "wss://purplepag.es/",
    "wss://relay.nostrgraph.net/",
    "wss://nostr.bitcoiner.social",
    "wss://no.str.cr",
    "wss://nostr.inosta.cc",
    "wss://nostr.oxtr.dev",
    "wss://relay.nostrati.com"
];


// Helper to simulate delay
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// NDK instance for Nostr operations
const ndk = new NDK({ explicitRelayUrls: RELAYS });

// Read keys and flags from the file, or initialize as empty object if file doesn't exist
let keysAndFlags;
try {
    keysAndFlags = JSON.parse(fs.readFileSync(KEYS_AND_FLAGS_FILE));
} catch (err) {
    console.error('Error reading keys_and_flags.json, initializing as empty object.', err);
    keysAndFlags = {};
}

// Generate a new signer for the "Lightning mailing archive", or load from keys_and_flags.json if exists
let archiveSigner;
if (keysAndFlags[ARCHIVE_USERNAME_KEY]?.privateKey) {
    const privateKey = keysAndFlags[ARCHIVE_USERNAME_KEY].privateKey;
    archiveSigner = new NDKPrivateKeySigner(privateKey);
} else {
    archiveSigner = NDKPrivateKeySigner.generate();
    keysAndFlags[ARCHIVE_USERNAME_KEY] = {
        privateKey: archiveSigner.privateKey,
        publicKey: archiveSigner._user.npub,
        broadcasted: true,
        relays: ndk.explicitRelayUrls
    };
    try {
        fs.writeFileSync(KEYS_AND_FLAGS_FILE, JSON.stringify(keysAndFlags));
    } catch (err) {
        console.error('Error writing to file', err);
    }
}

// Function to connect to NDK
async function ndk_connect() {
    await ndk.connect();
}

// Function to generate a Nostr account for the mailing list archive
async function generateArchiveAccount() {
    ndk.signer = archiveSigner; // Set the default signer to the archiveSigner
    const event = new NDKEvent(ndk);
    event.kind = 0; // 0 for profile event
    event.content = JSON.stringify({
        name: "Lightning Mailing List",
        about: "This account operates as a mirror of the Lightning mailing list"
    });

    await event.publish();
    await sleep(SLEEP_DELAY);
}

// Helper to get checkpoints from file, or initialize as an empty set if file doesn't exist
function getCheckpoints(checkpointsFile) {
    if (fs.existsSync(checkpointsFile)) {
        const rawData = fs.readFileSync(checkpointsFile);
        return new Set(JSON.parse(rawData));
    }
    return new Set();
}

// Helper to get the path of the JSON file for a given month, or null if none exists
function getMonthlyFile(year, month) {
    const extendedFile = path.join(DIR, `lightning_dev_${year}_${month}_extended.json`);
    const regularFile = path.join(DIR, `lightning_dev_${year}_${month}.json`);
    if (fs.existsSync(extendedFile)) {
        return extendedFile;
    } else if (fs.existsSync(regularFile)) {
        return regularFile;
    } else {
        return null;
    }
}

// Function to process a month of threads
async function processMonth(year, month) {
    console.log(year, month);
    const checkpoints = getCheckpoints(THREADS_CHECKPOINTS_FILE);
    const file = getMonthlyFile(year, month);
    if (file) {
        const threads = JSON.parse(fs.readFileSync(file));
        for (let thread of threads) {
            console.log(`Processing thread ${thread.thread_summary.title}`)
            await processThread(thread, checkpoints)
        }
    }
}

// Function to process all months
async function handleAllMonths() {
    for (let year = START_YEAR; year <= END_YEAR; year++) {
        for (let i = 1; i <= 12; i++) {
            const month = ('0' + i).slice(-2); // zero-pad single digit months
            await processMonth(year, month);
        }
    }
}


// Function to process a thread
async function processThread(thread, checkpoints) {
    const threadEvent = await createAndPublishThreadEvent(thread, checkpoints);
    //console.log(threadEvent.content)
    let prevMessageId = threadEvent.id;  
    let prevMessageAuthor = ARCHIVE_USERNAME_KEY;

    // Process the messages in the thread
    for (let message of thread.thread_messages) {
        console.log(`Processing message by ${message.author} on ${message.date}`);
        await sleep(SLEEP_DELAY)
        // Process a single message
        let messageEvent = await processMessage(message, prevMessageId, threadEvent.id, prevMessageAuthor);

        // Update the ID and author of the last message
        prevMessageId = messageEvent.id;
        prevMessageAuthor = message.author;
    }
}

// Function to create and publish a thread event
async function createAndPublishThreadEvent(thread, checkpoints) {
    ndk.signer = archiveSigner;
    let threadEvent = new NDKEvent(ndk);
    threadEvent.kind = 1;

    let contentString = composeThreadContent(thread);
    let authorTags = getAuthorTags(thread.thread_summary.authors);

    threadEvent.content = contentString;
    threadEvent.tags = authorTags;

    threadEvent.sign()
    await publishEvent(threadEvent, checkpoints);
    return threadEvent;
}

// Function to compose the content of a thread event
function composeThreadContent(thread) {
    let title = thread.thread_summary.title;
    let categories = thread.thread_summary.categories.join(', ');
    let authors = thread.thread_summary.authors;
    let messages_count = thread.thread_summary.messages_count;
    let total_chars = thread.thread_summary.total_messages_chars_count;
    let convo_summary = thread.thread_summary.convo_summary;

    let dates = thread.thread_messages.map(message => new Date(message.date));
    let min_date = new Date(Math.min.apply(null, dates));
    let max_date = new Date(Math.max.apply(null, dates));

    let contentString = `🔖 Title: ${title}\n`;
    contentString += `🏷️ Categories: ${categories}\n`;
    contentString += `👥 Authors: ${getAuthorsList(authors)}\n`;

    if (convo_summary) {
        contentString += `🗒️ Conversation Summary: ${convo_summary}\n`;
    }

    contentString += getMessageDateRange(min_date, max_date);
    contentString += `✉️ Message Count: ${messages_count}\n`;
    contentString += `📚 Total Characters in Messages: ${total_chars}\n`;

    return contentString;
}

// Function to get the authors list
function getAuthorsList(authors) {
    let authorList = '';

    if (authors.length === 1) {
        authorList += getAuthorDetail(authors[0]);
    } else {
        for (let author of authors) {
            authorList += `\n• ${getAuthorDetail(author)}`;
        }
    }

    return authorList;
}

// Function to get author detail
function getAuthorDetail(author) {
    let ndkUser = new NDKUser({ npub: keysAndFlags[author].publicKey });
    let pubkey = ndkUser.hexpubkey();
    return `${author} ( nostr:${keysAndFlags[author].publicKey} )`;
}

// Function to get the author tags for a thread
function getAuthorTags(authors) {
    let authorTags = [];
    
    for (let author of authors) {
        let ndkUser = new NDKUser({ npub: keysAndFlags[author].publicKey });
        let pubkey = ndkUser.hexpubkey();
        authorTags.push(['p', pubkey]);
    }

    return authorTags;
}

// Function to get message date range
function getMessageDateRange(min_date, max_date) {
    if (min_date.toISOString().substring(0, 10) === max_date.toISOString().substring(0, 10)) {
        return `📅 Messages Date: ${min_date.toISOString().substring(0, 10)}\n`;
    } else {
        return `📅 Messages Date Range: ${min_date.toISOString().substring(0, 10)} to ${max_date.toISOString().substring(0, 10)}\n`;
    }
}

// Function to publish an event and update checkpoints
async function publishEvent(event, checkpoints) {
    await event.sign()
    if (!checkpoints.has(event.id)) {
        try {
            event.publish()
            checkpoints.add(event.id);
            // Save checkpoints to file immediately
            let checkpointsArray = Array.from(checkpoints);
            fs.writeFileSync(THREADS_CHECKPOINTS_FILE, JSON.stringify(checkpointsArray));

            await sleep(SLEEP_DELAY);
        } catch (error) {
            console.log(`Error while publishing event: ${error.message}`);
        }
    }
}

// Function to process a message within a thread
async function processMessage(message, prevMessageId, threadEventId, prevMessageAuthor) {
    let messageEvent = new NDKEvent(ndk);
    messageEvent.kind = 1;

    // Set message tags
    setMessageTags(messageEvent, prevMessageId, threadEventId, prevMessageAuthor);
    console.log(messageEvent.tags)
    
    try {
        // Set signer
        setSigner(message.author);
    } catch (error) {
        console.log(error.message);
        return;
    }

    // Set content
    let messageContent = composeMessageContent(message);
    messageEvent.content = messageContent;
    messageEvent.sign();

    // Publish the message
    
    await messageEvent.publish();
    await sleep(SLEEP_DELAY)

    return messageEvent
}

// Function to set the tags for a message
function setMessageTags(event, prevMessageId, threadEventId, prevMessageAuthor) {
    if (prevMessageId !== threadEventId) {
        event.tags = [["e", threadEventId, "", "root"]];
        event.tags.push(['e', prevMessageId, "", "reply"]);
    } else {
        event.tags = [['e', prevMessageId, "", "reply"]];
    }

    if (prevMessageAuthor) {
        let ndkUser = new NDKUser({ npub: keysAndFlags[prevMessageAuthor].publicKey });
        let pubkeyHex = ndkUser.hexpubkey();
        event.tags.push(['p', pubkeyHex]);
    }
}

// Function to set the signer for a message
function setSigner(author) {
    // If privateKey is present in JSON, use it
    if (keysAndFlags[author]?.privateKey) {
        const privateKey = keysAndFlags[author].privateKey;
        ndk.signer = new NDKPrivateKeySigner(privateKey);
    } else {
        // Throw an error if the author doesn't have a private key
        throw new Error('Author does not have a private key');
    }
}

// Function to compose the content of a message
function composeMessageContent(message) {
    let messageContent = `📅 Original date posted:${new Date(message.date).toISOString().substring(0, 10)}\n`

    // Check if summary exists
    if (message.summary) {
        messageContent += `🗒️ Summary of this message: ${message.summary}\n`;
    }

    messageContent += `📝 Original message:\n`;
    messageContent += message.message_text_only;
    
    return messageContent;
}




// Main function to execute all tasks
async function main() {
    await ndk_connect();
    await generateArchiveAccount();
    await handleAllMonths();
}

// Run the main function
main().catch(err => console.error(err));
