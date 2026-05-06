// Test script for plate learning system
const plateMatcher = require('./src/services/plateMatcher');
const db = require('./src/db');

async function test() {
  console.log('=== Plate Learning System Test ===\n');
  
  // Test 1: Levenshtein distance
  console.log('Test 1: Levenshtein Distance');
  console.log('34YF9876 vs 34YF957:', plateMatcher.levenshteinDistance('34YF9876', '34YF957'));
  console.log('34DML77 vs 43WW42:', plateMatcher.levenshteinDistance('34DML77', '43WW42'));
  console.log('34KRC45 vs 34K5458:', plateMatcher.levenshteinDistance('34KRC45', '34K5458'));
  
  // Test 2: Similarity Score
  console.log('\nTest 2: Similarity Score');
  console.log('34YF9876 vs 34YF957:', plateMatcher.similarityScore('34YF9876', '34YF957') + '%');
  console.log('34DML77 vs 43WW42:', plateMatcher.similarityScore('34DML77', '43WW42') + '%');
  
  // Test 3: Check if plate_learnings table exists
  console.log('\nTest 3: Database Check');
  try {
    const exists = await db.schema.hasTable('plate_learnings');
    console.log('plate_learnings table exists:', exists);
    
    if (exists) {
      const count = await db('plate_learnings').count('* as cnt').first();
      console.log('Records in plate_learnings:', count.cnt);
    }
  } catch (e) {
    console.error('DB Error:', e.message);
  }
  
  // Test 4: Test learning functionality
  console.log('\nTest 4: Learning Test');
  try {
    // Simulate: OCR reads "34YF957", user corrects to "34YF9876"
    await plateMatcher.recordLearning('34YF957', '34YF9876');
    console.log('Learning recorded: 34YF957 -> 34YF9876');
    
    // Now test if it remembers
    const match = await plateMatcher.findBestMatch('34YF957');
    console.log('After learning, findBestMatch("34YF957"):', JSON.stringify(match));
  } catch (e) {
    console.error('Learning Error:', e.message);
  }
  
  // Test 5: Check registered plates
  console.log('\nTest 5: Registered Plates');
  try {
    const plates = await db('araclar').select('plaka').limit(5);
    console.log('Sample registered plates:', plates.map(p => p.plaka));
  } catch (e) {
    console.error('DB Error:', e.message);
  }
  
  console.log('\n=== Test Complete ===');
  process.exit(0);
}

test().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
