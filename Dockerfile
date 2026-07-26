# Static site for Coolify / any Docker host.
# Copy this pattern into other repos to reuse the same Coolify setup.

FROM nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html

# Config was copied for the image build; don't serve the deploy folder
RUN rm -rf /usr/share/nginx/html/deploy \
    /usr/share/nginx/html/Dockerfile

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
