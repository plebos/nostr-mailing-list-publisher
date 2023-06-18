const fs = require('fs');
const path = require('path');

const { NDKEvent, NDKPrivateKeySigner, NDKUser } = require('@nostr-dev-kit/ndk');

const { nip19 } = require("nostr-tools");
const { arch } = require('os');

const NDK = require('@nostr-dev-kit/ndk').default;

const LIST_CHOOSER = 'bitcoin';

// Constants
const ARCHIVE_USERNAME_KEY = `${LIST_CHOOSER.charAt(0).toUpperCase() + LIST_CHOOSER.slice(1)} mailing archive`;
console.log(ARCHIVE_USERNAME_KEY);

//const ARCHIVE_USERNAME_KEY = "TEST1";
const ARCHIVE_DETAILS_USERNAME_KEY = "Conversation Details"
const DIR = `${LIST_CHOOSER}_threads`;
const START_YEAR = 2015;
const END_YEAR = 2023;
//const THREADS_CHECKPOINTS_FILE = 'ln_checkpoints_2.json';
const SLEEP_DELAY = 100; // ms delay between actions
const KEYS_AND_FLAGS_FILE = 'keys_and_flags.json';
const RELAYS = [
    "wss://no.str.cr",
    "wss://relay.damus.io",
    "wss://eden.nostr.land",
    "wss://nostr.mutinywallet.com",
    "wss://puravida.nostr.land",
    "wss://purplepag.es/",
    "wss://relay.nostrgraph.net/",
    "wss://nostr.bitcoiner.social",
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

function getArchiveSigner(usernameKey) {
    let archiveSigner;
    if (keysAndFlags[usernameKey]?.privateKey) {
        const privateKey = keysAndFlags[usernameKey].privateKey;
        archiveSigner = new NDKPrivateKeySigner(privateKey);
    } else {
        archiveSigner = NDKPrivateKeySigner.generate();
        keysAndFlags[usernameKey] = {
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
    return archiveSigner;
}

let archiveSigner = getArchiveSigner(ARCHIVE_USERNAME_KEY);
console.log(archiveSigner);

let archiveDetailsSigner = getArchiveSigner(ARCHIVE_DETAILS_USERNAME_KEY);
console.log(archiveDetailsSigner);

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
        name: ARCHIVE_USERNAME_KEY,
        about: "This account operates as a mirror of the Lightning mailing list"
    });
    console.log("PUBLISH ARCHIVE")
    await publishEvent(event)
}

// Function to generate a Nostr account for the mailing list archive
async function generateArchiveDetailsAccount() {
    ndk.signer = archiveDetailsSigner; // Set the default signer to the archiveSigner
    const event = new NDKEvent(ndk);
    event.kind = 0; // 0 for profile event
    event.content = JSON.stringify({
        name: ARCHIVE_DETAILS_USERNAME_KEY,
        about: "This account operates as a mailing list threads details publisher"
    });
    console.log("PUBLISH ARCHIVE DETAILS")
    await publishEvent(event)
}
// Helper to get the path of the JSON file for a given month, or null if none exists
function getMonthlyFile(year, month) {
    const extendedFile = path.join(DIR, `${LIST_CHOOSER}_dev_${year}_${month}.json`);
    console.log(extendedFile)
    //const regularFile = path.join(DIR, `lightning_dev_${year}_${month}.json`);
    if (fs.existsSync(extendedFile)) {
        return extendedFile;
        //}
        //} else if (fs.existsSync(regularFile)) {
        //    return regularFile;
    } else {
        return null;
    }
}

function createBackupFile(originalFile) {
    const backupFile = originalFile.replace('.json', '_backup_before_publish.json');
    fs.copyFileSync(originalFile, backupFile);
    console.log(`Created backup file: ${backupFile}`);
    return backupFile;
}


// Function to process a month of threads
async function processMonth(year, month) {
    console.log(year, month);
    const file = getMonthlyFile(year, month);
    if (file) {
        const threads = JSON.parse(fs.readFileSync(file));
        createBackupFile(file)
        for (let thread of threads) {
            if (thread.new || thread.has_new_messages) {
                console.log(`Processing thread ${thread.thread_summary.title}`)
                await processThread(thread, file)
            }
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
async function processThread(thread, fileName) {
    let threadEventId = ''
    let prevMessageId = ''
    let prevMessageAuthor = ARCHIVE_USERNAME_KEY

    if (thread.new) {
        const threadEvent = await createAndPublishThreadEvent(thread);
        threadEventId = threadEvent.id;
        updateThreadInJsonFile(thread.id, fileName, threadEventId)
    } else if (thread.has_new_messages) {
        threadEventId = thread.published_note_id
        let summaryEvent = await createAndPublishThreadSummaryEvent(thread);
    } else {
        return;
    }

    prevMessageId = threadEventId;

    // Process the new messages in the thread
    for (let message of thread.thread_messages) {
        // Process a single message
        if (message.new) {
            console.log(`Processing message by ${message.author} on ${message.date}`);
            let messageEvent = await processMessage(message, prevMessageId, threadEventId, prevMessageAuthor);
            // Update the ID and author of the last message
            updateMessageInJsonFile(thread.id, message.id, fileName, messageEvent.id)
            prevMessageId = messageEvent.id;
            prevMessageAuthor = message.author;
        } else {
            prevMessageId = message.published_note_id;
            prevMessageAuthor = message.author;
        }
    }
    // set has new messages flag to false
    updateThreadInJsonFile(thread.id, fileName, threadEventId, true)
}


// Function to update a message in the thread in the json file
function updateMessageInJsonFile(threadId, messageId, fileName, publishedNoteId) {
    let threads = JSON.parse(fs.readFileSync(fileName));
    const threadIndex = threads.findIndex(t => t.id === threadId);
    console.log("HERE")
    console.log(messageId)
    if (threadIndex !== -1) {
        const messageIndex = threads[threadIndex].thread_messages.findIndex(m => m.id === messageId);
        if (messageIndex !== -1) {
            // Update the message's id with the newEventId if it doesn't exist or it's empty
            if (!threads[threadIndex].thread_messages[messageIndex].published_note_id || threads[threadIndex].thread_messages[messageIndex].published_note_id === '') {
                threads[threadIndex].thread_messages[messageIndex].published_note_id = publishedNoteId;
            }
            // update as not new
            threads[threadIndex].thread_messages[messageIndex].new = false;
        }
    }
    fs.writeFileSync(fileName, JSON.stringify(threads));
}


// Function to update the thread in the json file
function updateThreadInJsonFile(threadId, fileName, publishedNoteId, newMessagesHandled = false) {
    let threads = JSON.parse(fs.readFileSync(fileName));
    const index = threads.findIndex(t => t.id === threadId);
    console.log("HERE")
    console.log(threadId)
    if (index !== -1) {
        // Update the thread's id with the newEventId if it doesn't exist or it's empty
        if (!threads[index].published_note_id || threads[index].published_note_id === '') {
            threads[index].published_note_id = publishedNoteId;
        }
        if (newMessagesHandled) {
            threads[index].has_new_messages = false;
        }
        // Mark new as false
        threads[index].new = false;
    }
    fs.writeFileSync(fileName, JSON.stringify(threads));
}


// Function to create and publish a thread event
async function createAndPublishThreadEvent(thread) {


    await createAndPublishThreadSummaryEvent(thread);

    ndk.signer = archiveSigner;
    let threadEvent = new NDKEvent(ndk);
    threadEvent.kind = 1;

    threadEvent.content = composeThreadContent(thread);
    threadEvent.tags = getAllThreadTags(thread);

    await publishEvent(threadEvent);
    return threadEvent;
}

// Function to create and publish a thread event
async function createAndPublishThreadSummaryEvent(thread) {

    let authors = thread.thread_summary.authors;
    let messages_count = thread.thread_summary.messages_count;
    let total_chars = thread.thread_summary.total_messages_chars_count;
    let convo_summary = thread.thread_summary.convo_summary;
    let dates = thread.thread_messages.map(message => new Date(message.date));
    let min_date = new Date(Math.min.apply(null, dates));
    let max_date = new Date(Math.max.apply(null, dates));

    let contentString = ``;

    let threadSummaryTags = [];
    threadSummaryTags.push(['d', thread.id])
    //threadSummaryTags.push(['d', 123123])
    threadSummaryTags.push(['title', "Conversation Details"])
    //threadSummaryTags.push(['published_at', (Math.floor(Date.now() / 1000)).toString()])
    threadSummaryTags.push(['image', 'https://nostr.build/i/dbc5bd7993c8d036431edeefea63a2b3b796e1f49baf96bf6b09e13c8c662833.jpg'])
    

    if (convo_summary) {
        contentString += `📝 Summary: ${convo_summary}\n\n`
    }
    contentString += `👥 Authors: ${getAuthorsList(authors)}\n\n`;
    contentString += getMessageDateRange(min_date, max_date);
    contentString += `\n`;
    contentString += `✉️ Message Count: ${messages_count}\n\n`;
    contentString += `📚 Total Characters in Messages: ${total_chars}\n\n`;

    // Checking if any message contains a summary
    if (thread.thread_messages.some(message => message.summary)) {
        contentString += `## Messages Summaries\n`;

        // Adding individual message summaries to the content string
        thread.thread_messages.forEach(message => {
            if (message.summary) {
                contentString += `\n✉️ Message by ${message.author} on ${new Date(message.date).toLocaleDateString()}:\n${message.summary}\n`;
            }
        });
    }

    contentString += `\n\nFollow nostr:${archiveSigner._user.npub} for full threads`;

    ndk.signer = archiveDetailsSigner;
    let threadSummaryEvent = new NDKEvent(ndk);
    threadSummaryEvent.kind = 30023;
    threadSummaryEvent.tags = [...threadSummaryTags, ...getAuthorTags(authors)];
    threadSummaryEvent.tags.push(['p',archiveSigner._user.hexpubkey()])
    threadSummaryEvent.content = contentString;
    await publishEvent(threadSummaryEvent)
    return threadSummaryEvent;
}


// Function to compose the content of a thread event
function composeThreadContent(thread) {
    let title = thread.thread_summary.title;
    let categories = thread.thread_summary.categories.join(', ');
    //let authors = thread.thread_summary.authors;
    //let messages_count = thread.thread_summary.messages_count;
    //let total_chars = thread.thread_summary.total_messages_chars_count;
    //let convo_summary = thread.thread_summary.convo_summary;

    //let dates = thread.thread_messages.map(message => new Date(message.date));
    //let min_date = new Date(Math.min.apply(null, dates));
    //let max_date = new Date(Math.max.apply(null, dates));

    let contentString = `🔖 Title: ${title}\n`;
    contentString += `🏷️ Categories: ${categories}\n`;
    //contentString += `👥 Authors: ${getAuthorsList(authors)}\n`;


    //contentString += `🗒️ Conversation Summary: ${convo_summary}\n`;
    //contentString += `🗒️ Conversation Summary: \n`;

    //console.log(thread)
    //console.log(threadSigner)
    let result = nip19.naddrEncode({
        identifier: thread.id,
        pubkey: archiveDetailsSigner._user.hexpubkey(),
        kind: 30023,
        relays: RELAYS.slice(0, 3) // Take the first three relay URLs 
    });
    contentString += ` nostr:${result} \n`;

    //contentString += getMessageDateRange(min_date, max_date);
    //contentString += `✉️ Message Count: ${messages_count}\n`;
    //contentString += `📚 Total Characters in Messages: ${total_chars}\n`;
    contentString += `⚠️ Heads up! We've now started linking to replaceable long-form events (NIP-23), which allow for dynamic display of thread details like summaries, authors, and more. If you're unable to see this, your client may not support this feature yet.`
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


function getAllThreadTags(thread) {
    let summaryTags = getSummaryTags(thread);
    //We moved authorTags to the summary (it can change over time)
    //let authorTags = getAuthorTags(thread.thread_summary.authors);
    return summaryTags;
}

// Function to get the summary tags for a thread
function getSummaryTags(thread) {
    let summaryTags = [];

    summaryTags.push(['a', `30023:${archiveDetailsSigner._user.hexpubkey()}:${thread.id}`, RELAYS[0]])

    return summaryTags;
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
async function publishEvent(event) {

    try {
        await event.sign()
        console.log(`PUBLISH EVENT ${event.id}`)
        console.log(`PUBLISH EVENT ${JSON.stringify(event)}`);
        event.publish()
        //checkpoints.add(hahedContents);
        // Save checkpoints to file immediately
        //let checkpointsArray = Array.from(checkpoints);
        //fs.writeFileSync(THREADS_CHECKPOINTS_FILE, JSON.stringify(checkpointsArray));
        await sleep(SLEEP_DELAY);
    } catch (error) {
        console.log(`Error while publishing event: ${error.message}`);
    }
}

// Function to process a message within a thread
async function processMessage(message, prevMessageId, threadEventId, prevMessageAuthor) {
    let messageEvent = new NDKEvent(ndk);
    messageEvent.kind = 1;

    // Set message tags
    setMessageTags(messageEvent, prevMessageId, threadEventId, prevMessageAuthor);

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
    // Publish the message

    await publishEvent(messageEvent)
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
    //const checkpoints = getCheckpoints(THREADS_CHECKPOINTS_FILE);
    await ndk_connect();
    // await generateArchiveAccount();
    await generateArchiveDetailsAccount();
    await handleAllMonths();
}

// Run the main function
main().catch(err => console.error(err));
