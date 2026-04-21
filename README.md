
+5
Lines changed: 5 additions & 0 deletions


Original file line number	Diff line number	Diff line change
@@ -1,3 +1,8 @@
const version = await nodeVersionAlias("lts");
console.log(`Using Node.js ${version}`);

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
0 commit comments
Comments
0
